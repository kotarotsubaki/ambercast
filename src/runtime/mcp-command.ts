import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isJSONRPCNotification, isJSONRPCRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createMcpServer } from '#adapters/mcp/server.js';
import { createSystemClock } from '#adapters/system/system-clock.js';
import { createMcpProgressSink } from '#adapters/mcp/progress-sink.js';
import { escapeControlChars } from '#adapters/system/control-chars.js';
import type { McpProgressContext, McpServerDeps } from '#adapters/mcp/types.js';
import { runCheckCommand, type CheckCommandInput } from '#runtime/check-command.js';
import { runGenerateCommand, type GenerateCommandInput } from '#runtime/generate-command.js';
import { prepareHeal, type HealCommandInput, type HealPreparation } from '#runtime/heal-command.js';
import { runRunCommand, type RunCommandInput } from '#runtime/run-command.js';

/**
 * Process-independent inputs for MCP command composition.
 *
 * @remarks
 * Explicit directory, timeout, and streams let tests replace the CLI process
 * boundary while exercising the same transport and shutdown composition.
 */
export interface RunMcpCommandInput {
  readonly dir: string;
  readonly syncWaitMs: number;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

/**
 * Job record for write operations (generate/run/heal-preview).
 *
 * @remarks
 * A write call creates a record on enqueue. Queued and running jobs both
 * retain working status: a read derives `queued behind <N>` in statusMessage
 * for a queued job, so queue position does not require another status value.
 * statusMessage is always non-empty: while running it is `running` until the
 * first RunEvent, then the latest fixed progress phrase. At termination it
 * becomes the terminal status, except for cancellation before invocation
 * (`cancelled before start`) and shutdown of a queued job
 * (`server shutting down`). Terminal status remains fixed.
 * A running cancellation settles when the
 * runtime returns; cancelling before invocation settles through FIFO removal.
 * Progress counts every RunEvent emitted by the runtime, regardless of
 * whether the client supplied a progressToken or received a notification.
 * The polling recommendation and post-terminal retention period are fixed
 * protocol contracts, so neither varies by job: pollIntervalMs is 2000 ms
 * and ttlMs is 1800000 ms.
 */
export interface JobRecord {
  readonly jobId: string;
  readonly tool: 'generate' | 'run' | 'heal';
  readonly status: 'working' | 'completed' | 'failed' | 'cancelled';
  readonly statusMessage: string;
  readonly progress: number;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly pollIntervalMs: number;
  readonly ttlMs: number;
}

type HealProposal = {
  preparation: HealPreparation;
  state: 'pending' | 'superseded' | 'consumed';
  deliveredAt?: number;
  settledAt?: number;
  output?: import('#adapters/mcp/types.js').ToolOutcome;
  finalized?: boolean;
  completion?: Promise<import('#adapters/mcp/types.js').ToolOutcome>;
  finish?: (outcome: import('#adapters/mcp/types.js').ToolOutcome) => void;
  settling?: Promise<import('#adapters/mcp/types.js').ToolOutcome>;
  setProgress?: (progress: McpProgressContext) => () => Promise<void>;
};

type ToolOutcome = import('#adapters/mcp/types.js').ToolOutcome;

function inflightKey(id: string | number): string { return `${typeof id}:${String(id)}`; }

/**
 * Wraps a transport send so failed deliveries can be reported without changing
 * the caller's completion path.
 *
 * @remarks
 * A response is identified by its id and result or error, while a method with
 * no id is a notification and a method with an id is a request. Distinct
 * diagnostics identify which protocol action was lost without making the
 * caller infer it from an absent reply. The method is escaped with
 * `escapeControlChars` imported from `#adapters/system/control-chars.js`,
 * following this runtime module's existing dependency direction toward
 * system adapters, so diagnostic text cannot contain raw control characters.
 *
 * The lower send call and stderr write each need their own try boundary:
 * a synchronous throw and a rejected send are both delivery failures, while
 * a failing diagnostic must never escape or prevent the returned promise from
 * resolving. `context.onResponse` connects the session's in-flight ledger
 * decrement to this wrapper immediately after invoking the lower send, before
 * awaiting its promise and even if the call throws synchronously. Once
 * `context.isClosed()` is true, this wrapper neither invokes the lower send
 * nor writes to stderr, preserving the closed transport's silent behavior.
 * Each failed delivery writes exactly one stderr line. This wrapper is the
 * sole authoritative owner of send-failure diagnostics; `createMcpProgressSink`
 * has no stderr output, avoiding duplicate reports for a failed notification.
 */
export function createGuardedSend(
  send: (message: JSONRPCMessage, options?: TransportSendOptions) => Promise<void>,
  context: { stderr: NodeJS.WritableStream; isClosed: () => boolean; onResponse?: (id: string | number) => void },
): typeof send {
  return async (message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> => {
    if (context.isClosed()) return;

    const hasId = 'id' in message;
    const isResponse = hasId && ('result' in message || 'error' in message);
    const isNotification = 'method' in message && !hasId;
    const method = 'method' in message ? message.method : undefined;

    const writeError = (kind: string, method?: string): void => {
      try {
        const methodText = method !== undefined ? ` (${escapeControlChars(method)})` : '';
        context.stderr.write(`ambercast mcp: failed to send a ${kind}${methodText}\n`);
      } catch {
        /* Logging cannot block shutdown. */
      }
    };

    let sent: Promise<void> | undefined;
    try {
      sent = options !== undefined ? send(message, options) : send(message);
    } catch {
      if (isResponse && context.onResponse) {
        try {
          const responseId = message.id;
          if (responseId !== undefined) context.onResponse(responseId as string | number);
        } catch {
          /* Ledger accounting is secondary to reporting the failed send. */
        }
      }
      writeError(isResponse ? 'response' : isNotification ? 'notification' : 'request', method);
      return;
    }

    if (isResponse && context.onResponse) {
      try {
        const responseId = message.id;
        if (responseId !== undefined) context.onResponse(responseId as string | number);
      } catch {
        /* Ledger accounting cannot interrupt send completion or diagnostics. */
      }
    }

    try {
      await sent;
    } catch {
      writeError(isResponse ? 'response' : isNotification ? 'notification' : 'request', method);
    }
  };
}

function invalidHealToken(reason: 'missing' | 'unknown-token' | 'superseded' | 'expired'): ToolOutcome {
  return { kind: 'error', code: 'HEAL_APPLY_TOKEN_INVALID', message: reason };
}

function failedHealApply(error: unknown): ToolOutcome {
  return {
    kind: 'error', code: 'HEAL_APPLY_FAILED',
    message: `the apply crashed unexpectedly (${error instanceof Error ? error.name : 'Error'})`,
  };
}

/**
 * Keeps write authority inside one MCP session. Token lookup checks
 * unknown, superseded, expired, consumed, then pending in that order; the
 * pending-to-consumed transition occurs before confirmation. Preview creation
 * supersedes older pending proposals eagerly, while pending expiry is checked
 * only at apply. Delivery starts the pending TTL; settlement starts a separate
 * replay window. Both windows use the injected monotonic clock and remain
 * valid through the exact ten-minute boundary. A consumed-token replay waits
 * for its original confirmation, settlement, and response rendering instead
 * of invoking the one-shot settle capability again. Tokens are process-local
 * and never persisted in the plan.
 */
class HealProposalStore {
  private readonly proposals = new Map<string, HealProposal>();

  constructor(private readonly monotonicMs: () => number) {}

  /**
   * Issues a random opaque token after preparation resolves for preview.
   * Issuance eagerly supersedes older pending proposals in this session;
   * no token is issued when preparation has no commits or throws.
   */
  issue(preparation: HealPreparation, setProgress?: HealProposal['setProgress']): string {
    const token = randomBytes(16).toString('hex');
    for (const proposal of this.proposals.values()) {
      if (proposal.state === 'pending') proposal.state = 'superseded';
    }
    this.proposals.set(token, { preparation, state: 'pending', ...(setProgress === undefined ? {} : { setProgress }) });
    return token;
  }

  /** Anchors pending-token expiry to first client delivery, not cache rendering. */
  markDelivered(token: string): void {
    const proposal = this.proposals.get(token);
    if (proposal === undefined || proposal.deliveredAt !== undefined) return;
    proposal.deliveredAt = this.monotonicMs();
  }

  /** The pending TTL has one checkpoint, before confirmation can delay settlement. */
  async consume(token: string): Promise<{ proceed: true; cases: readonly { file: string; healingSummary: string }[] } | { proceed: false; outcome: ToolOutcome }> {
    const proposal = this.proposals.get(token);
    if (proposal === undefined) return { proceed: false, outcome: invalidHealToken(token === '' ? 'missing' : 'unknown-token') };
    if (proposal.state === 'superseded') return { proceed: false, outcome: invalidHealToken('superseded') };
    if (proposal.state === 'consumed') {
      if (proposal.settledAt !== undefined && this.monotonicMs() - proposal.settledAt > 600_000) {
        return { proceed: false, outcome: invalidHealToken('expired') };
      }
      if (proposal.finalized && proposal.output !== undefined) return { proceed: false, outcome: proposal.output };
      return { proceed: false, outcome: await proposal.completion! };
    }
    if (proposal.state === 'pending') {
      if (proposal.deliveredAt !== undefined && this.monotonicMs() - proposal.deliveredAt > 600_000) {
        return { proceed: false, outcome: invalidHealToken('expired') };
      }
      proposal.state = 'consumed';
      proposal.completion = new Promise<ToolOutcome>((resolve) => { proposal.finish = resolve; });
      return { proceed: true, cases: proposal.preparation.cases.map(({ file, healingSummary }) => ({ file, healingSummary })) };
    }
    throw new Error('unreachable state');
  }

  /** Settlement remains one-shot while consumed-token replays await its output. */
  async settle(token: string, confirm: 'authorized' | 'declined' | 'interrupted', progress?: McpProgressContext): Promise<ToolOutcome> {
    const proposal = this.proposals.get(token);
    if (proposal?.state !== 'consumed') throw new Error('heal proposal must be consumed before settlement');
    if (proposal.settling === undefined) {
      const flush = progress === undefined ? undefined : proposal.setProgress?.(progress);
      const settlePromise = Promise.resolve().then(() => proposal.preparation.settle(confirm)).then(async (output) => {
        await flush?.();
        return this.save(proposal, { kind: 'report', exitCode: output.exitCode, envelope: output.envelope });
      }).catch(async (error: unknown) => {
        try { await flush?.(); } catch { /* Preserve the settlement failure. */ }
        return this.save(proposal, failedHealApply(error));
      });
      proposal.settling = settlePromise;
    }
    return await proposal.settling;
  }

  /** Stores an unexpected confirmation or queue failure for identical replay. */
  async fail(token: string, error: unknown): Promise<ToolOutcome> {
    const proposal = this.proposals.get(token);
    if (proposal?.state !== 'consumed') return invalidHealToken('unknown-token');
    if (proposal.settling !== undefined) await proposal.settling;
    if (proposal.finalized || proposal.output?.kind === 'error') {
      this.finalize(token);
      return proposal.output!;
    }
    const outcome = this.save(proposal, failedHealApply(error));
    this.finalize(token);
    return outcome;
  }

  /** Publishes a stored outcome only after its MCP response renders successfully. */
  finalize(token: string): void {
    const proposal = this.proposals.get(token);
    if (proposal?.state !== 'consumed' || proposal.output === undefined || proposal.finalized) return;
    proposal.finalized = true;
    proposal.finish?.(proposal.output);
  }

  private save(proposal: HealProposal, outcome: ToolOutcome): ToolOutcome {
    proposal.settledAt = this.monotonicMs();
    proposal.output = outcome;
    return outcome;
  }

  async apply(token: string, confirm: 'authorized' | 'declined' | 'interrupted', signal?: AbortSignal): Promise<import('#adapters/mcp/types.js').ToolOutcome> {
    const consumed = await this.consume(token);
    if (!consumed.proceed) return consumed.outcome;
    const outcome = await this.settle(token, signal?.aborted ? 'interrupted' : confirm);
    this.finalize(token);
    return outcome;
  }
}

function normalizeCommonMcpInput(args: Record<string, unknown>): Record<string, unknown> {
  const { ai, ...rest } = args;
  return {
    ...rest,
    files: args.files ?? [],
    allowEmpty: args.allowEmpty ?? false,
    ...(ai !== undefined ? { aiProviderOverride: ai } : {}),
  };
}

function progressSink(command: 'generate' | 'run' | 'heal', sessionRoot: string, progress: McpProgressContext) {
  if (progress.progressToken === undefined) return undefined;
  const progressToken = progress.progressToken;
  let sequence = 0;
  let pendingFlush = Promise.resolve();
  const sink = createMcpProgressSink({
    command,
    sessionRoot,
    // Job callers observe each event immediately; apply uses the same
    // projection without creating a job record.
    onEvent: () => {
      void progress.sendNotification({ method: 'internal/run-event' });
      pendingFlush = pendingFlush.then(() => sink.flush());
    },
    send: (message) => progress.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress: ++sequence, message },
    }),
  });
  return { emit: sink.emit, flush: async () => { await pendingFlush; await sink.flush(); } };
}

/**
 * Runs the MCP command over caller-provided streams.
 *
 * @param input - Session directory, wait policy, and protocol streams.
 * @returns Exit status for the CLI process boundary.
 * @remarks
 * The first stdin end, SIGTERM, or SIGINT begins draining; later triggers are
 * ignored. While draining, new tools/call requests receive no response. Active
 * calls have their signals aborted, and shutdown waits at most 10,000 ms for
 * all calls. If they finish in time, server.close() runs before exit code 0;
 * otherwise the command exits with code 3. Results obtained after abort are
 * sent only while the transport remains open; otherwise they are discarded.
 * A connection failure reports its error name on stderr and exits with code 3.
 * A failed send writes one line to stderr. Nothing is written to stdout after
 * close() is called.
 */
export async function runMcpCommand(input: RunMcpCommandInput): Promise<number> {
  // Redirect incidental library logging before startup so stdout stays a JSON-RPC stream.
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]): void => { console.error(...args); };
  try {
    return await serveMcpCommand(input);
  } finally {
    console.log = originalConsoleLog;
  }
}

async function serveMcpCommand(input: RunMcpCommandInput): Promise<number> {
  const sessionRoot = resolve(process.cwd(), input.dir);
  let drainRequested = false;
  const requestEarlyDrain = (): void => { drainRequested = true; };
  input.stdin.once('end', requestEarlyDrain);
  process.once('SIGTERM', requestEarlyDrain);
  process.once('SIGINT', requestEarlyDrain);
  let validDirectory = false;
  try {
    validDirectory = (await stat(sessionRoot)).isDirectory();
  } catch {
    // A missing or inaccessible path cannot serve as a session root.
  } finally {
    input.stdin.removeListener('end', requestEarlyDrain);
    process.removeListener('SIGTERM', requestEarlyDrain);
    process.removeListener('SIGINT', requestEarlyDrain);
  }
  if (!validDirectory) {
    input.stderr.write(`ambercast mcp: --dir ${sessionRoot} is not a directory.\n`);
    return 2;
  }

  let draining = false;
  const drainController = new AbortController();
  const inflight = new Map<string, number>();
  let notifyIdle: (() => void) | undefined;
  const changeInflight = (id: string | number, delta: 1 | -1): void => {
    const key = inflightKey(id);
    const count = inflight.get(key) ?? 0;
    if (delta < 0 && count === 0) return;
    if (count + delta === 0) inflight.delete(key);
    else inflight.set(key, count + delta);
    notifyIdle?.();
  };
  let rejectedCalls = 0;
  const controllers = new Set<AbortController>();
  const active = new Set<Promise<void>>();

  function trackActive<T>(promise: Promise<T>): Promise<T> {
    const completion = promise.then(() => undefined, () => undefined);
    active.add(completion);
    return promise.finally(() => { active.delete(completion); notifyIdle?.(); });
  }

  /* One controller per invocation keeps the abort boundary at runtime composition. */
  async function track<T>(invoke: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    controllers.add(controller);
    if (draining) controller.abort();
    const result = invoke(controller.signal);
    const completion = result.then(() => undefined, () => undefined);
    active.add(completion);
    try {
      return await result;
    } finally {
      controllers.delete(controller);
      active.delete(completion);
      notifyIdle?.();
    }
  }

  const proposals = new HealProposalStore(() => createSystemClock().monotonicMs());
  const deps: McpServerDeps = {
    sessionRoot,
    version: __VERSION__,
    stderr: input.stderr,
    generate: (args, progress, jobSignal) => track(async (drainSignal) => {
      const signal = AbortSignal.any([drainSignal, jobSignal].filter((candidate): candidate is AbortSignal => candidate !== undefined));
      const inputArgs = args as Record<string, unknown>;
      const sink = progressSink('generate', sessionRoot, progress);
      try {
        return await runGenerateCommand({
          ...normalizeCommonMcpInput(inputArgs),
          strict: inputArgs.strict ?? false,
          force: inputArgs.force ?? false,
          dryRun: inputArgs.dryRun ?? false,
          cwd: sessionRoot, stderr: input.stderr, list: false, signal,
          ...(sink === undefined ? {} : { events: sink }),
        } as unknown as GenerateCommandInput);
      } finally {
        await sink?.flush();
      }
    }),
    run: (args, progress, jobSignal) => track(async (drainSignal) => {
      const signal = AbortSignal.any([drainSignal, jobSignal].filter((candidate): candidate is AbortSignal => candidate !== undefined));
      const inputArgs = args as Record<string, unknown>;
      const { grep, ...normalized } = normalizeCommonMcpInput(inputArgs);
      const sink = progressSink('run', sessionRoot, progress);
      try {
        return await runRunCommand({
          ...normalized,
          ...(typeof grep === 'string' ? { grep: new RegExp(grep) } : {}),
          resolve: inputArgs.resolve ?? false,
          updateCache: inputArgs.updateCache ?? false,
          cwd: sessionRoot, stderr: input.stderr,
          headed: false, list: false, stale: 'fail', signal,
          ...(sink === undefined ? {} : { events: sink }),
        } as unknown as RunCommandInput);
      } finally {
        await sink?.flush();
      }
    }),
    check: (args) => track((signal) => {
      const inputArgs = args as Record<string, unknown>;
      return runCheckCommand({
        ...normalizeCommonMcpInput(inputArgs),
        cwd: sessionRoot, stderr: input.stderr, list: false, signal,
      } as unknown as CheckCommandInput);
    }),
    // Issuance supersedes older pending proposals; delivery starts the new TTL.
    healPreview: (args, progress, jobSignal) => track(async (drainSignal) => {
      const signal = AbortSignal.any([drainSignal, jobSignal].filter((candidate): candidate is AbortSignal => candidate !== undefined));
      const inputArgs = args as Record<string, unknown>;
      let sink = progressSink('heal', sessionRoot, progress);
      const events: NonNullable<HealCommandInput['events']> = { emit: (event) => sink?.emit(event) };
      try {
        const preparation = await prepareHeal({
          ...normalizeCommonMcpInput(inputArgs), cwd: sessionRoot, stderr: input.stderr,
          dryRun: true, yes: false, list: false, signal,
          events,
        } as unknown as HealCommandInput);
        const previewResult = await preparation.preview();
        if (!preparation.hasCommits) return previewResult;
        const token = proposals.issue(preparation, (applyProgress) => {
          sink = progressSink('heal', sessionRoot, applyProgress);
          return async () => { await sink?.flush(); sink = undefined; };
        });
        return { ...previewResult, applyToken: token };
      } finally {
        await sink?.flush();
        sink = undefined;
      }
    }),
    markHealDelivered: (token) => proposals.markDelivered(token),
    beginHealApply: (token) => trackActive(proposals.consume(token)),
    settleHealApply: (token, confirm, _signal, progress) => trackActive(proposals.settle(token, confirm, progress)),
    finalizeHealApply: (token) => trackActive(Promise.resolve().then(() => proposals.finalize(token))),
    failHealApply: (token, error) => trackActive(proposals.fail(token, error)),
    applyHeal: (token, confirm, signal) => trackActive(proposals.apply(token, confirm, signal)),
  };

  const proxy = new PassThrough();
  const reader = createInterface({ input: input.stdin as Readable });
  reader.on('line', (line) => {
    if (!draining) {
      proxy.write(`${line}\n`);
      return;
    }
    try {
      const message: unknown = JSON.parse(line);
      if (typeof message === 'object' && message !== null && 'method' in message
        && message.method === 'tools/call') rejectedCalls += 1;
    } catch {
      // Invalid input is already excluded from the protocol stream during drain.
    }
  });

  const server = createMcpServer(deps, { signal: drainController.signal, syncWaitMs: input.syncWaitMs, clock: createSystemClock() });
  const transport = new StdioServerTransport(proxy, input.stdout as Writable);
  /**
   * Protocol assigns the transport's message handler during connect, so observing
   * SDK-accepted requests requires intercepting that assignment beforehand.
   * The getter must expose undefined until the real handler is assigned: a
   * premature wrapper would look like an existing handler to Protocol and
   * could register observation twice. The wrapper counts an
   * isJSONRPCRequest on receipt and an isJSONRPCNotification cancellation
   * only when params.requestId is truthy, as SDK 1.30 ignores falsy ids.
   * The ledger counts each id separately and ignores cancellation or response
   * for an id with no outstanding requests. Even if a client violates MCP by
   * reusing an id, the remaining request is removed by its response regardless
   * of which request the SDK cancelled. Observation continues after draining
   * begins for lines already forwarded to the SDK.
   */
  const send = transport.send.bind(transport);
  let heldHandler: typeof transport.onmessage;
  Object.defineProperty(transport, 'onmessage', {
    get: () => heldHandler === undefined ? undefined : (message: Parameters<NonNullable<typeof transport.onmessage>>[0]) => {
      if (isJSONRPCRequest(message)) changeInflight(message.id, 1);
      else if (isJSONRPCNotification(message) && message.method === 'notifications/cancelled') {
        const requestId = message.params?.requestId;
        if (requestId && (typeof requestId === 'string' || typeof requestId === 'number')) changeInflight(requestId, -1);
      }
      return heldHandler?.(message);
    },
    set: (handler: typeof transport.onmessage) => { heldHandler = handler; },
  });
  let transportClosed = false;
  const guardedSend = createGuardedSend(send, {
    stderr: input.stderr,
    isClosed: () => transportClosed,
    onResponse: (id) => changeInflight(id, -1),
  });
  transport.send = guardedSend;
  let beginDrain: (() => void) | undefined;
  const drainStarted = new Promise<void>((resolveDrain) => { beginDrain = resolveDrain; });
  const onDrain = (): void => {
    if (draining) return;
    draining = true;
    for (const controller of controllers) controller.abort();
    drainController.abort();
    beginDrain?.();
  };
  input.stdin.once('end', onDrain);
  process.on('SIGTERM', onDrain);
  process.on('SIGINT', onDrain);
  if (drainRequested) onDrain();

  try {
    try {
      await server.connect(transport);
    } catch (error) {
      input.stderr.write(`ambercast mcp: failed to start (${error instanceof Error ? error.name : 'Error'})\n`);
      return 3;
    }
    input.stderr.write(`ambercast mcp: serving ${sessionRoot}\n`);
    if ((input.stdin as Readable).readableEnded) onDrain();
    await drainStarted;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    /**
     * The drain loop re-evaluates while either the request ledger or
     * runtime calls remain active. Every ledger change (+1 or -1) and active
     * call settlement triggers re-evaluation; a simple notification to the
     * waiter suffices. A send decrements the ledger only for a response with
     * an id and either result or error, unlike request and notification
     * classification. Fixed microtask waits cannot cover delayed response
     * sends. A reader line reaches the proxy and SDK onmessage synchronously,
     * so no extra tick is needed to discover transferred work.
     */
    const settled = (async () => {
      while (inflight.size > 0 || active.size > 0) {
        await new Promise<void>((resolveIdle) => { notifyIdle = resolveIdle; });
        notifyIdle = undefined;
      }
      return true;
    })();
    const timedOut = new Promise<false>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout(false), 10_000);
    });
    const finished = await Promise.race([settled, timedOut]);
    if (timeout !== undefined) clearTimeout(timeout);
    if (rejectedCalls > 0) {
      input.stderr.write(`ambercast mcp: rejected ${rejectedCalls} call(s) during shutdown\n`);
    }
    transportClosed = true;
    proxy.end();
    if (!finished) {
      void server.close().catch(() => {});
      return 3;
    }
    await server.close();
    return 0;
  } finally {
    input.stdin.removeListener('end', onDrain);
    process.removeListener('SIGTERM', onDrain);
    process.removeListener('SIGINT', onDrain);
    reader.close();
    proxy.end();
  }
}
