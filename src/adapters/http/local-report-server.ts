// HTTP server adapter for the ambercast viewer.

import http from 'node:http';
import type { ViewPlan } from '#runtime/view-command.js';
import { PortUnavailableError } from '#core/errors/port-unavailable-error.js';
import { createRequestListener } from './router.js';

/**
 * Starts a local, read-only HTTP server for the prepared viewer plan.
 *
 * @param plan - Bind host, ordered port candidates, and report reader.
 * @param options - Abort signal for shutdown and the CLI's diagnostic stream.
 * @returns The actual listening URL and a promise settled after shutdown.
 * @throws {PortUnavailableError} When every candidate is occupied or a bind
 * fails for another reason.
 * @remarks
 * Candidate ports are tried in order, advancing only for EADDRINUSE. The
 * signal is checked immediately before every listen attempt, including after
 * a failed candidate, so abort stops the loop without another bind. The
 * listener receives `server.address().port` after listen succeeds: Host
 * validation must use the real bound port, including an OS-assigned port,
 * rather than the candidate that was requested.
 *
 * On abort, shutdown closes the listener and active connections and removes
 * signal listeners. The `closed` promise must fulfill on this path even if
 * `close()` throws, allowing the CLI to preserve signal exit code 0. A signal
 * received before listening likewise ends without binding a socket.
 */
export async function startLocalReportServer(
  plan: ViewPlan,
  options: { readonly signal: AbortSignal; readonly stderr: NodeJS.WritableStream },
): Promise<{ readonly url: string; readonly closed: Promise<void> }> {
  const server = http.createServer();
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    options.signal.removeEventListener('abort', shutdown);
    try {
      server.close(() => resolveClosed());
    } catch {
      resolveClosed();
    } finally {
      try { server.closeAllConnections(); } catch { resolveClosed(); }
    }
  };

  const aborted = () => {
    if (!options.signal.aborted) return false;
    shutdown();
    return true;
  };
  if (aborted()) return { url: '', closed };

  for (const port of plan.candidates) {
    if (aborted()) return { url: '', closed };
    const error = await new Promise<Error | undefined>((resolve) => {
      const onError = (failure: Error) => {
        server.off('error', onError);
        resolve(failure);
      };
      server.once('error', onError);
      server.listen(port, plan.bindHost, () => {
        server.off('error', onError);
        resolve(undefined);
      });
    });
    if (error === undefined) {
      const boundPort = (server.address() as { readonly port: number }).port;
      server.on('request', createRequestListener(plan, boundPort));
      options.signal.addEventListener('abort', shutdown, { once: true });
      if (aborted()) return { url: '', closed };
      const host = plan.bindHost.includes(':') ? `[${plan.bindHost}]` : plan.bindHost;
      return { url: `http://${host}:${boundPort}/`, closed };
    }
    if (aborted()) return { url: '', closed };
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EADDRINUSE') {
      throw new PortUnavailableError(`Cannot bind ${plan.bindHost}:${port} (${code}).`,
        { host: plan.bindHost, attempted: [port], code }, { cause: error });
    }
    if (plan.strict) {
      throw new PortUnavailableError(`Port ${port} on ${plan.bindHost} is in use.`,
        { host: plan.bindHost, attempted: [port] }, { cause: error });
    }
  }
  if (aborted()) return { url: '', closed };
  const first = plan.candidates[0]!;
  const last = plan.candidates.at(-1)!;
  throw new PortUnavailableError(`No free port in ${first}-${last} on ${plan.bindHost}.`,
    { host: plan.bindHost, attempted: [first, last] });
}
