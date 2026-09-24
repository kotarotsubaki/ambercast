import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '#adapters/mcp/server.js';
import { createSystemClock } from '#adapters/system/system-clock.js';
import { createMcpProgressSink } from '#adapters/mcp/progress-sink.js';
import type { McpProgressContext, McpServerDeps } from '#adapters/mcp/types.js';
import { runCheckCommand, type CheckCommandInput } from '#runtime/check-command.js';
import { runGenerateCommand, type GenerateCommandInput } from '#runtime/generate-command.js';
import { prepareHeal, type HealCommandInput } from '#runtime/heal-command.js';
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
    // The job record observes every event immediately. Flushing each projection
    // also exposes its fixed phrase while the job is still running.
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
  let rejectedCalls = 0;
  const controllers = new Set<AbortController>();
  const active = new Set<Promise<void>>();

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
    }
  }

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
    healPreview: (args, progress, jobSignal) => track(async (drainSignal) => {
      const signal = AbortSignal.any([drainSignal, jobSignal].filter((candidate): candidate is AbortSignal => candidate !== undefined));
      const inputArgs = args as Record<string, unknown>;
      const sink = progressSink('heal', sessionRoot, progress);
      try {
        const preparation = await prepareHeal({
          ...normalizeCommonMcpInput(inputArgs), cwd: sessionRoot, stderr: input.stderr,
          dryRun: true, yes: false, list: false, signal,
          ...(sink === undefined ? {} : { events: sink }),
        } as unknown as HealCommandInput);
        return await preparation.preview();
      } finally {
        await sink?.flush();
      }
    }),
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
  const send = transport.send.bind(transport);
  let transportClosed = false;
  transport.send = async (...args: Parameters<typeof transport.send>): Promise<void> => {
    if (transportClosed) return;
    try {
      await send(...args);
    } catch {
      input.stderr.write('ambercast mcp: failed to send a response\n');
    }
  };
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
    const settled = (async () => {
      while (active.size > 0) await Promise.race(active);
      // Let handlers serialize any final result while the transport is open.
      await Promise.resolve();
      await Promise.resolve();
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
