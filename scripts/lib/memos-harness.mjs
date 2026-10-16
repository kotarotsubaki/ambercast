#!/usr/bin/env node
/**
 * memos-harness.mjs — library functions for the Memos verification harness
 *
 * Resource and process mechanisms are injectable so verification can exercise
 * failures without Docker or an AI provider. The CLI owns lifecycle policy.
 */

import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export const MEMOS_IMAGE = 'neosmemo/memos:0.31.0';
export const MEMOS_VERSION = '0.31.0';
export const HOST = '127.0.0.1';
// ponytail: A fixed loopback endpoint preserves the committed plan's inputsDigest;
// concurrent instances require a separate port/freshness design.
export const PORT = 5230;
export const BASE_URL = 'http://127.0.0.1:5230';
export const ADMIN_USERNAME = 'verifier';
export const LABEL = 'ambercast-verify=memos';
export const NAME_PREFIX = 'ambercast-verify-memos-';
export const READY = { timeoutMs: 30000, intervalMs: 200, requestTimeoutMs: 1000, logTail: 40 };
export const TIMEOUTS = { docker: 60000, pull: 300000, pack: 300000, replay: 120000, judge: 120000, generate: 900000, resolve: 900000 };

/** A failure attributed to a verification stage for final reporting.
 * @param stage - Public stage name.
 * @param message - Diagnostic reason, redacted before output.
 */
export class HarnessError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'HarnessError';
    this.stage = stage;
  }
}

/** A Docker operation failure whose stage is assigned by the caller.
 * @param message - Docker diagnostic without request credentials.
 */
export class RunnerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunnerError';
  }
}

/**
 * Reports a process group whose termination could not be confirmed.
 * @remarks The caller assigns the verification stage; this error carries only
 * process identity so a Docker adapter cannot misattribute a lifecycle failure.
 */
export class TerminationUnconfirmedError extends Error {
  /** @param {number} pgid - Process group requiring manual termination. */
  constructor(pgid) {
    super(`process group ${pgid} not confirmed terminated`);
    this.pgid = pgid;
  }
}

/** A readiness failure with its stage fixed independently of the caller.
 * @param message - Elapsed-time or container-exit evidence and bounded logs.
 */
export class ReadyError extends HarnessError {
  constructor(message) {
    super('ready', message);
    this.name = 'ReadyError';
  }
}

/** An initialization failure with its stage fixed independently of the caller.
 * @param message - Freshness reason or method/path/status, never HTTP bodies.
 */
export class BootstrapError extends HarnessError {
  constructor(message) {
    super('bootstrap', message);
    this.name = 'BootstrapError';
  }
}

/**
 * Creates an asynchronous Docker executor accepting argv and process options.
 * @param runProcessImpl - Child-process primitive; defaults to runProcess.
 * @returns An executor resolving to the process result, including captured output.
 * @throws Propagates process launch failures.
 * @remarks This thin wrapper delegates all termination to runProcess so Docker
 * and every other child share one process-group cancellation contract. It has
 * no independent spawn or kill policy.
 */
export function createExec(runProcessImpl = runProcess) {
  return (args, options) => runProcessImpl('docker', args, options);
}

/**
 * Creates Docker operations for daemon/image checks, container lifecycle,
 * environment inspection, bounded logs, and labeled-container discovery.
 * @param exec - Asynchronous Docker argv executor with timeout/signal support.
 * @returns A runner whose startContainer accepts runId, name, data, uid and gid;
 * queries return parsed values and lifecycle commands resolve on success.
 * @throws RunnerError for unsuccessful operations; an absent image is false
 * and removing a nonexistent container succeeds.
 * @throws TerminationUnconfirmedError when an executor reports unconfirmed
 * termination; this takes precedence over status and absent-container evidence.
 * @remarks Named, labeled containers allow cleanup even after an ambiguous
 * client failure. Host ownership permits data removal on Linux; disabling rate
 * limiting through the environment avoids ENTRYPOINT argument assumptions.
 */
export function createDockerRunner(exec) {
  function assertTerminationConfirmed(result) {
    if (result.termination === 'unconfirmed') throw new TerminationUnconfirmedError(result.pgid);
  }
  async function call(method, args, options, absent = false) {
    const result = await exec(args, { timeoutMs: TIMEOUTS.docker, ...options });
    assertTerminationConfirmed(result);
    if (result.status !== 0 && !(absent && /No such container/i.test(result.stderr))) {
      throw new RunnerError(`${method}: ${result.stderr.split('\n')[0]}`);
    }
    return result;
  }
  return {
    async checkDaemon(options) { await call('checkDaemon', ['info'], options); },
    async hasImage(image, options) {
      const result = await exec(['image', 'inspect', image], { timeoutMs: TIMEOUTS.docker, ...options });
      assertTerminationConfirmed(result);
      return result.status === 0;
    },
    async pullImage(image, options) { await call('pullImage', ['pull', image], { timeoutMs: TIMEOUTS.pull, ...options }); },
    async startContainer({ runId, name, data, uid, gid }, options) {
      const result = await call('startContainer', ['run', '-d', '--pull', 'never', '--name', name,
        '--label', LABEL, '--label', `ambercast-verify-run=${runId}`, '-p', `${HOST}:${PORT}:${PORT}`,
        '-v', `${data}:/var/opt/memos`, '-e', `MEMOS_UID=${uid}`, '-e', `MEMOS_GID=${gid}`,
        '-e', 'MEMOS_RATE_LIMIT=false', MEMOS_IMAGE], options);
      return result.stdout.trim();
    },
    async isRunning(name, options) {
      const result = await exec(['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: TIMEOUTS.docker, ...options });
      assertTerminationConfirmed(result);
      return result.status === 0 && result.stdout.trim() === 'true';
    },
    async inspectEnv(name, options) {
      const result = await call('inspectEnv', ['inspect', '-f', '{{.Config.Env}}', name], options);
      return result.stdout.trim().replace(/^\[|\]$/g, '').split(/\s+/).filter(Boolean);
    },
    async inspectCreated(name, options) {
      return (await call('inspectCreated', ['inspect', '-f', '{{.Created}}', name], options)).stdout.trim();
    },
    async tailLogs(name, tail, options) {
      const result = await call('tailLogs', ['logs', '--tail', String(tail), name], options);
      return result.stdout + result.stderr;
    },
    async removeContainer(name, options) { await call('removeContainer', ['rm', '-f', name], options, true); },
    async listContainers(options) {
      return (await call('listContainers', ['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Names}}'], options))
        .stdout.split('\n').map(value => value.trim()).filter(Boolean);
    },
  };
}

/**
 * Checks whether an endpoint can be bound, releasing the probe before resolving.
 * @param port - Host port to probe.
 * @param host - Bind address, defaulting to loopback.
 * @param listen - Optional injected listener; defaults to a node:net probe.
 * @returns A promise resolving when the probe has closed.
 * @throws HarnessError at stage port for EADDRINUSE; other listen errors propagate.
 * @remarks This provides an early diagnostic, not a reservation. Docker's later
 * bind remains authoritative; the existing listener is never stopped.
 */
export async function assertPortFree(port, host = HOST, listen = undefined) {
  try {
    if (listen) return await listen(port, host);
    await new Promise((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(port, host, () => {
        s.close(error => error ? reject(error) : resolve());
      });
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') throw new HarnessError('port', `port ${port} on ${host} is in use`);
    throw error;
  }
}

/**
 * Publishes a private run directory containing owner.pid and empty data/project directories.
 * @param tmpRoot - Parent temporary directory.
 * @param randomBytes - Random source used to allocate the run identity.
 * @param fns - Optional mkdirSync/renameSync/rmSync/writeFileSync/existsSync bag.
 * @returns The runId, runRoot, dataDir, projectDir and containerName.
 * @throws HarnessError at preflight after six collisions; other creation errors
 * propagate after removing only the temporary directory owned by this call.
 * @remarks Build under a private temporary name, then rename, so reapers cannot
 * observe an unfinished published root. Allow one attempt plus five new IDs;
 * preexisting names and mkdir EEXIST are collisions, not permission to reuse.
 * Recheck the destination immediately before rename to avoid replacing an
 * existing empty directory on POSIX; clean our temporary root before retrying.
 * ponytail: The check does not eliminate TOCTOU. The residual collision risk
 * with a 32-bit random ID is accepted because portable Node lacks RENAME_NOREPLACE.
 */
export function createRunRoot(tmpRoot, randomBytes, fns = undefined) {
  const io = fns ?? fs;
  for (let attempt = 0; attempt < 6; attempt++) {
    const runId = randomBytes(4).toString('hex');
    const containerName = NAME_PREFIX + runId;
    const runRoot = join(tmpRoot, containerName);
    const temporary = runRoot + '.tmp';
    if (io.existsSync(runRoot) || io.existsSync(temporary)) continue;
    try { io.mkdirSync(temporary, { mode: 0o700 }); } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
    try {
      io.writeFileSync(join(temporary, 'owner.pid'), String(process.pid));
      io.mkdirSync(join(temporary, 'data'));
      io.mkdirSync(join(temporary, 'project'));
      if (io.existsSync(runRoot)) {
        io.rmSync(temporary, { recursive: true, force: true });
        continue;
      }
      io.renameSync(temporary, runRoot);
    } catch (error) {
      io.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
    return { runId, runRoot, dataDir: join(runRoot, 'data'), projectDir: join(runRoot, 'project'), containerName };
  }
  throw new HarnessError('preflight', 'runId allocation failed after six collisions');
}

/**
 * Replaces occurrences of the run password with a disclosure-safe marker.
 * @param text - Complete text to sanitize before harness output.
 * @param password - Run password whose literal occurrences must be hidden.
 * @returns Sanitized text; producer artifacts remain untouched for judging.
 * @remarks Streaming callers must retain a carry-over suffix before invoking
 * this replacement so a secret split across chunks cannot escape detection.
 */
export function redact(text, password) {
  return text.split(password).join('[redacted]');
}

/**
 * Copies an environment without inherited CI, GITHUB_ACTIONS or AMBERCAST_* values,
 * then adds the harness-controlled values.
 * @param parentEnv - Parent environment, left unchanged.
 * @param secrets - Environment-name/value map to add after isolation.
 * @returns A fresh child environment.
 * @remarks Isolation prevents parent config/provider selection from changing
 * replay and prevents an inherited judge mode from downgrading full validation.
 */
export function buildChildEnv(parentEnv, secrets) {
  const childEnv = { ...parentEnv };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith('CI') || key.startsWith('GITHUB_ACTIONS') || key.startsWith('AMBERCAST_')) {
      delete childEnv[key];
    }
  }
  for (const key of Object.keys(secrets)) {
    childEnv[key] = secrets[key];
  }
  return childEnv;
}

/**
 * Generates a fresh hexadecimal administrator password from cryptographic randomness.
 * @param randomBytes - Optional random source, defaulting to node:crypto.
 * @returns A 32-character lowercase hexadecimal password.
 * @throws Propagates random-source failures.
 * @remarks Callers keep the value out of argv and output; only HTTP bodies and
 * secret environment entries carry it, except private credentials under --keep.
 */
export function generateAdminPassword(randomBytes = cryptoRandomBytes) {
  return randomBytes(16).toString('hex');
}

/**
 * Waits for a running container's health endpoint to return HTTP 200 by the deadline.
 * @param opts - fetch, runner, name, optional baseUrl, clock (now/sleep), signal,
 * timeoutMs and intervalMs for polling.
 * @returns Elapsed milliseconds on readiness, including success exactly at the deadline.
 * @throws ReadyError for deadline/container exit with bounded log evidence;
 * propagates cancellation as AbortError.
 * @remarks The same deadline covers running checks, requests and sleeps.
 * Recheck abort and deadline immediately after every await; a late 200 cannot
 * establish readiness. Each individual request is limited to 1,000 ms and the
 * remaining budget, whichever is smaller
 * (`Math.min(READY.requestTimeoutMs, remainingBudget)`). Catch only ordinary
 * network/request-timeout failures; an aborted caller signal must be rethrown
 * rather than treated as another poll. Log collection uses the same signal and
 * READY.requestTimeoutMs as its timeout to preserve cancellation.
 */
export async function waitReady(opts) {
  const { fetch, runner, name, clock, signal, baseUrl = BASE_URL,
    timeoutMs = READY.timeoutMs, intervalMs = READY.intervalMs } = opts;
  const start = clock.now();
  const deadline = start + timeoutMs;
  async function fail(reason) {
    signal?.throwIfAborted();
    const logs = await runner.tailLogs(name, READY.logTail, { signal, timeoutMs: READY.requestTimeoutMs });
    signal?.throwIfAborted();
    throw new ReadyError(`${reason}; elapsed=${clock.now() - start}ms; logs:\n${logs}`);
  }
  for (;;) {
    signal?.throwIfAborted();
    if (clock.now() > deadline) return fail(`not ready after ${timeoutMs}ms`);
    const running = await runner.isRunning(name, { signal, timeoutMs: Math.min(deadline - clock.now(), 5000) });
    signal?.throwIfAborted();
    if (clock.now() > deadline) return fail(`not ready after ${timeoutMs}ms`);
    if (!running) return fail('container exited');
    let response;
    try {
      response = await fetch(baseUrl + '/healthz', { signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(Math.min(READY.requestTimeoutMs, Math.max(1, deadline - clock.now()))),
      ]) });
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof TypeError) && error?.name !== 'TimeoutError' && error?.name !== 'AbortError') throw error;
    }
    signal?.throwIfAborted();
    if (clock.now() > deadline) return fail(`not ready after ${timeoutMs}ms`);
    if (response?.status === 200) return clock.now() - start;
    if (clock.now() >= deadline) return fail(`not ready after ${timeoutMs}ms`);
    await clock.sleep(Math.min(intervalMs, deadline - clock.now()), signal);
    signal?.throwIfAborted();
    if (clock.now() > deadline) return fail(`not ready after ${timeoutMs}ms`);
  }
}

/**
 * Initializes a fresh instance and verifies administrator sign-in.
 * @param opts - fetch, optional baseUrl/username, password and cancellation signal.
 * @returns A promise resolving after successful sign-in, without retaining its token.
 * @throws BootstrapError for a non-fresh profile, HTTP/network/JSON failure or
 * missing nonempty accessToken; diagnostics exclude request and response bodies.
 * @remarks Check profile before creating a user, then verify password credentials.
 * Each request has a five-second limit and none is retried: a disconnected
 * non-idempotent user creation is safely abandoned by discarding the instance.
 */
export async function bootstrapAdmin(opts) {
  const { fetch, password, signal, baseUrl = BASE_URL, username = ADMIN_USERNAME } = opts;
  async function request(method, path, body, statuses) {
    let response;
    let value;
    try {
      response = await fetch(baseUrl + path, { method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]),
      });
      if (!statuses.includes(response.status)) throw new BootstrapError(`${method} ${path} -> ${response.status}`);
      value = await response.json();
    } catch (error) {
      if (error instanceof BootstrapError) throw error;
      throw new BootstrapError(`${method} ${path} -> network-error`);
    }
    return value;
  }
  const profile = await request('GET', '/api/v1/instance/profile', undefined, [200]);
  if (profile?.needsSetup !== true) throw new BootstrapError('instance is not fresh');
  await request('POST', '/api/v1/users', { username, role: 'ADMIN', password }, [200, 201]);
  const signin = await request('POST', '/api/v1/auth/signin', { passwordCredentials: { username, password } }, [200]);
  if (typeof signin?.accessToken !== 'string' || signin.accessToken.length === 0) {
    throw new BootstrapError('POST /api/v1/auth/signin -> 200');
  }
}

/**
 * Maps a consented logical secret name to the CLI secret environment convention.
 * @param name - Logical name from secrets.allow.
 * @returns An AMBERCAST_SECRET_ name with dots replaced by underscores and uppercase letters.
 */
export function secretEnvName(name) {
  return 'AMBERCAST_SECRET_' + name.replaceAll('.', '_').toUpperCase();
}

/**
 * Builds the private ESM manifest for an isolated tarball installation.
 * @param playwrightVersion - Repository-resolved playwright-core version.
 * @returns A manifest object with a playwright-core override.
 * @remarks Pin to the locally resolved browser library before installation so
 * npm does not select a version whose Chromium binary is absent on this machine.
 */
export function buildProjectPackageJson(playwrightVersion) {
  return { name: 'memos-verify-project', private: true, type: 'module', overrides: { 'playwright-core': playwrightVersion } };
}

/**
 * Summarizes AI usage from the last ordinary replay for human-facing reporting.
 * @param report - Replay envelope containing result rows.
 * @returns The sum when every row has a nonnegative integer aiCalls, otherwise
 * 'unknown', including an empty result set.
 * @remarks This is an informational copy; the shared judge determines acceptance.
 */
export function summarizeAiCalls(report) {
  const results = report.results;
  if (results.length === 0) return 'unknown';
  let sum = 0;
  for (const result of results) {
    const aiCalls = result.aiCalls;
    if (typeof aiCalls !== 'number' || aiCalls < 0 || !Number.isInteger(aiCalls)) {
      return 'unknown';
    }
    sum += aiCalls;
  }
  return sum;
}

/**
 * Creates a cleanup registry that attempts all callbacks once in reverse registration order.
 * @returns defer(label, fn) and runAll(), which resolves to an aggregated
 * HarnessError or null; subsequent runAll calls are no-ops.
 * @remarks Register a container before starting it because client failure does
 * not prove daemon-side absence. LIFO removes containers before their run roots,
 * and one failed callback cannot prevent cleanup of the remaining resources.
 */
export function createTeardown() {
  let callbacks = [];
  let ran = false;
  return {
    defer(label, fn) {
      callbacks.push({ label, fn });
    },
    async runAll() {
      if (ran) return null;
      ran = true;
      const errors = [];
      for (let i = callbacks.length - 1; i >= 0; i--) {
        try {
          await callbacks[i].fn();
        } catch (e) {
          errors.push(`${callbacks[i].label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      callbacks = [];
      if (errors.length > 0) {
        return new HarnessError('teardown', errors.join('; '));
      }
      return null;
    }
  };
}

/**
 * Reclaims attributable abandoned harness resources without disturbing live owners.
 * @param opts - runner, tmpRoot, optional tri-state isPidAlive and removal function rm.
 * @returns Counts of containers and directories actually removed; ENOENT is not counted.
 * @throws Propagates discovery or removal failures other than tolerated absence.
 * @remarks Independently discover labeled containers, published roots and temporary
 * roots into a runId-keyed table, classifying everything before deletion. Remove
 * each selected container before its paired directory so a crash retains ownership
 * evidence for the next pass. Dead owners permit reaping; a missing owner file
 * permits removal of a published root, whereas malformed/unreadable ownership is
 * unknown and reported without deletion. An unpaired container requires age over
 * ten minutes; temporary roots require age over a minute and missing/dead ownership.
 * Reap a fixture lock only for a dead pid and reread its contents immediately
 * before unlinking; a changed pid belongs to another acquirer and must be preserved.
 * ponytail: The lock recheck narrows TOCTOU but is not an OS-level lock guarantee.
 */
export async function reapStale(opts) {
  const { runner, tmpRoot, lockPath, isPidAlive = defaultIsPidAlive, rm = fs.rmSync,
    now = Date.now } = opts;
  const resources = new Map();
  const counts = { containers: 0, dirs: 0 };
  function row(runId) {
    if (!resources.has(runId)) resources.set(runId, { directories: [] });
    return resources.get(runId);
  }
  function classify(path) {
    let content;
    let state;
    try {
      content = fs.readFileSync(path, 'utf8');
      state = /^[1-9][0-9]{0,9}$/.test(content) ? isPidAlive(Number(content)) : 'unknown';
    } catch (error) {
      state = error?.code === 'ENOENT' ? 'missing' : 'unknown';
    }
    if (state === 'unknown' || state === 'live') process.stderr.write(`skip ${path}: owner ${state}\n`);
    return { content, state };
  }
  for (const container of await runner.listContainers()) {
    const match = /^ambercast-verify-memos-([0-9a-f]{8})$/.exec(container);
    if (match) row(match[1]).container = container;
  }
  for (const entry of fs.readdirSync(tmpRoot, { withFileTypes: true })) {
    const match = /^ambercast-verify-memos-([0-9a-f]{8})(\.tmp)?$/.exec(entry.name);
    if (!match || !entry.isDirectory()) continue;
    const path = join(tmpRoot, entry.name);
    const owner = classify(join(path, 'owner.pid'));
    const temporary = Boolean(match[2]);
    const old = !temporary || now() - fs.statSync(path).mtimeMs > 60000;
    const directory = { path, owner, remove: old && (owner.state === 'dead' || owner.state === 'missing') };
    const resource = row(match[1]);
    resource.directories.push(directory);
    if (!temporary) resource.published = directory;
  }
  for (const resource of resources.values()) {
    if (!resource.container) continue;
    if (resource.published) resource.removeContainer = resource.published.owner.state === 'dead';
    else if (resource.directories.length) {
      resource.removeContainer = resource.directories.some(directory => directory.owner.state === 'dead');
    } else {
      const created = await runner.inspectCreated(resource.container);
      resource.removeContainer = now() - Date.parse(created) > 600000;
    }
  }
  const lock = lockPath ? classify(lockPath) : undefined;
  function remove(path, options) {
    try { rm(path, options); return true; } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  for (const resource of resources.values()) {
    if (resource.removeContainer) {
      try { await runner.removeContainer(resource.container); counts.containers++; } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    for (const directory of resource.directories) {
      if (directory.remove && remove(directory.path, { recursive: true })) counts.dirs++;
    }
  }
  if (lock?.state === 'dead') {
    try {
      if (fs.readFileSync(lockPath, 'utf8') === lock.content) remove(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return counts;
}

/**
 * Classifies process ownership conservatively without sending a terminating signal.
 * @param pid - Valid positive owner pid.
 * @returns 'dead' only for ESRCH, 'live' for success or EPERM, and 'unknown' for
 * every other thrown value, including non-Error values.
 * @remarks Unknown is never authority to delete another run's resources.
 * ponytail: PID reuse and EPERM can retain stale resources by appearing live;
 * accepting leftovers is safer than deleting a possibly live owner's resources.
 */
export function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (e) {
    if (e?.code === 'ESRCH') return 'dead';
    if (e?.code === 'EPERM') return 'live';
    return 'unknown';
  }
}

/**
 * @typedef {object} ProcessResult
 * @property {number | null} status - Child exit status, or null on termination.
 * @property {string} stdout - Captured standard output.
 * @property {string} stderr - Captured standard error.
 * @property {string | null} signal - Exit or termination signal.
 * @property {'none' | 'confirmed' | 'unconfirmed'} termination - Group termination evidence.
 * @property {number} pgid - Detached child's process group identity.
 */

/**
 * Runs a child in a detached process group with shared timeout/cancellation handling.
 * @param command - Executable path or name.
 * @param args - Argument vector, never containing the password.
 * @param opts - cwd, env, timeoutMs, signal and stdio policy (`'capture'` by
 *   default, `'inherit-stderr'`, `'generate'`, or `'resolve'`). `'generate'` and
 *   `'resolve'` additionally require `onStderrChunk` (a sink writing to the
 *   harness's own stderr); `'resolve'` additionally requires `password` (the
 *   secret string to redact). `'generate'` runs before any password exists, so
 *   it forwards its captured stdout verbatim.
 * @returns {Promise<ProcessResult>} A process result with status, stdout, stderr, signal,
 *   termination ('none' | 'confirmed' | 'unconfirmed'), and pgid (child.pid).
 *   Nonzero exits remain results for the caller.
 * @throws Propagates process launch failures.
 * @remarks On abort/timeout, send group SIGTERM immediately and poll for ESRCH
 * every 100 ms for at most five seconds. If unconfirmed, send group SIGKILL and
 * poll for another five seconds. If still unconfirmed, emit one redacted warning
 * and resolve with signal SIGKILL rather than hanging the harness. Termination
 * is 'none' if cancellation was never attempted, 'confirmed' only after
 * observing ESRCH following SIGTERM or SIGKILL, and 'unconfirmed' if neither
 * bounded wait confirms absence. Child exit alone does not confirm group death.
 * ponytail: This is a best-effort cleanup bound, not a guarantee that a stuck
 * process group cannot outlive the harness.
 * `'generate'` inherits stdin and stderr because consent needs a real TTY on
 * both ends, and only captures/forwards stdout.
 * `'resolve'` inherits stdin but captures and forwards both stdout and stderr,
 * detecting passwords both within each stream and across arrival-order
 * boundaries before forwarding in arrival order. Captured report data (the raw bytes
 * before redaction) remains available for disclosure judging.
 */
export async function runProcess(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const mode = opts.stdio ?? 'capture';
    const forwarding = mode === 'generate' || mode === 'resolve';
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, detached: true,
      stdio: mode === 'inherit-stderr' || mode === 'generate' ? ['inherit', 'pipe', 'inherit']
        : mode === 'resolve' ? ['inherit', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
    const pgid = child.pid;
    let stdout = '';
    let stderr = '';
    let status = null;
    let exitSignal = null;
    let terminating = false;
    let termination = 'none';
    let settled = false;
    let timer;
    // Stream-local and arrival-order views share character references, so
    // interleaving cannot hide a match or reorder unrelated output. A prefix
    // that can still complete in either view holds back the output queue;
    // only process completion releases every pending tail, since a closed
    // stream's last prefix can still complete on the other stream.
    let pending = [];
    const tails = [[], [], []];
    let sequence = 0;
    const password = opts.password;
    function scan(view, characters) {
      const entries = [...tails[view], ...characters];
      const text = entries.map(entry => entry.character).join('');
      let match = text.indexOf(password);
      while (match !== -1) {
        for (let i = match; i < match + password.length; i++) entries[i].output = '';
        entries[match].output = '[redacted]';
        match = text.indexOf(password, match + 1);
      }
      let length = Math.min(password.length - 1, text.length);
      while (length > 0 && !text.endsWith(password.slice(0, length))) length--;
      tails[view] = length ? entries.slice(-length) : [];
    }
    function forward(final = false) {
      const boundary = final ? sequence
        : Math.min(sequence, ...tails.filter(tail => tail.length).map(tail => tail[0].sequence));
      let count = 0;
      while (count < pending.length && pending[count].sequence < boundary) count++;
      const output = pending.slice(0, count).map(entry => entry.output).join('');
      pending = pending.slice(count);
      if (output) opts.onStderrChunk(output);
    }
    function capture(stream, save, view) {
      if (!stream) return;
      stream.setEncoding('utf8');
      if (!forwarding || !opts.onStderrChunk) {
        stream.on('data', chunk => { save(chunk); });
        return;
      }
      stream.on('data', chunk => {
        chunk = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        save(chunk);
        if (!password) { opts.onStderrChunk(chunk); return; }
        const characters = chunk.split('').map(character => ({ character, output: character, sequence: sequence++ }));
        pending = pending.concat(characters);
        scan(view, characters);
        scan(2, characters);
        forward();
      });
    }
    capture(child.stdout, chunk => { stdout += chunk; }, 0);
    capture(child.stderr, chunk => { stderr += chunk; }, 1);
    function cleanup() {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', terminate);
    }
    function finish(signal = exitSignal) {
      if (settled) return;
      settled = true;
      cleanup();
      if (forwarding && opts.onStderrChunk) forward(true);
      resolve({ status: terminating ? null : status, stdout, stderr, signal, termination, pgid });
    }
    function send(signal) {
      try { process.kill(-child.pid, signal); } catch (error) {
        if (error?.code !== 'ESRCH') return false;
      }
      return true;
    }
    async function gone() {
      const deadline = Date.now() + 5000;
      for (;;) {
        try { process.kill(-child.pid, 0); } catch (error) {
          if (error?.code === 'ESRCH') return true;
        }
        if (Date.now() >= deadline) return false;
        await sleep(Math.min(100, deadline - Date.now()));
      }
    }
    async function terminate() {
      if (terminating || settled) return;
      terminating = true;
      cleanup();
      send('SIGTERM');
      if (await gone()) {
        termination = 'confirmed';
        finish('SIGTERM');
        return;
      }
      send('SIGKILL');
      if (await gone()) {
        termination = 'confirmed';
        finish('SIGKILL');
        return;
      }
      termination = 'unconfirmed';
      const warning = 'warning: process group termination could not be confirmed after SIGKILL\n';
      process.stderr.write(opts.password ? redact(warning, opts.password) : warning);
      finish('SIGKILL');
    }
    child.once('error', error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      status = code;
      exitSignal = signal;
      if (!terminating) finish();
    });
    opts.signal?.addEventListener('abort', terminate, { once: true });
    if (opts.timeoutMs !== undefined) {
      const timeoutMs = opts.timeoutMs;
      const startedAt = performance.now();
      const onTimeout = () => {
        if (settled || terminating) return;
        const remaining = timeoutMs - (performance.now() - startedAt);
        if (remaining > 0) { timer = setTimeout(onTimeout, remaining); return; }
        void terminate();
      };
      timer = setTimeout(onTimeout, timeoutMs);
    }
    if (opts.signal?.aborted) void terminate();
  });
}
