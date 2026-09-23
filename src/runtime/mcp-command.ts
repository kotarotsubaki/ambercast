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
  throw new Error('not implemented');
}
