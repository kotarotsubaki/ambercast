import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '#adapters/mcp/server.js';
import type { McpServerDeps } from '#adapters/mcp/types.js';
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
 * A failed send writes one line to stderr. Nothing is written to stdout after
 * close() is called.
 */
export async function runMcpCommand(input: RunMcpCommandInput): Promise<number> {
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
    generate: (args) => track((signal) => runGenerateCommand({
      ...(args as Record<string, unknown>), cwd: sessionRoot, stderr: input.stderr, list: false, signal,
    } as unknown as GenerateCommandInput)),
    run: (args) => track((signal) => runRunCommand({
      ...(args as Record<string, unknown>), cwd: sessionRoot, stderr: input.stderr,
      headed: false, list: false, stale: 'fail', signal,
    } as unknown as RunCommandInput)),
    check: (args) => track((signal) => runCheckCommand({
      ...(args as Record<string, unknown>), cwd: sessionRoot, stderr: input.stderr, list: false, signal,
    } as unknown as CheckCommandInput)),
    healPreview: (args) => track(async (signal) => {
      const preparation = await prepareHeal({
        ...(args as Record<string, unknown>), cwd: sessionRoot, stderr: input.stderr,
        dryRun: true, yes: false, list: false, signal,
      } as unknown as HealCommandInput);
      return preparation.preview();
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
      if ((JSON.parse(line) as { method?: unknown }).method === 'tools/call') rejectedCalls += 1;
    } catch {
      // Invalid input is already excluded from the protocol stream during drain.
    }
  });

  const server = createMcpServer(deps);
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
    beginDrain?.();
  };
  input.stdin.once('end', onDrain);
  process.once('SIGTERM', onDrain);
  process.once('SIGINT', onDrain);
  if (drainRequested) onDrain();

  try {
    await server.connect(transport);
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
