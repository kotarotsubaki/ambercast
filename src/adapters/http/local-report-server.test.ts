import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewPlan } from '../../runtime/view-command.js';
import { PortUnavailableError } from '../../core/errors/port-unavailable-error.js';
import { startLocalReportServer } from './local-report-server.js';

type BindOutcome = 'ok' | 'EADDRINUSE' | 'EACCES';

const httpFake = vi.hoisted(() => ({ createServer: vi.fn<(...args: unknown[]) => unknown>() }));
vi.mock('node:http', () => ({ default: { createServer: httpFake.createServer }, createServer: httpFake.createServer }));

function fakeServer(outcomes: ReadonlyMap<number, BindOutcome>, options: {
  onAttempt?: (port: number) => void;
  closeError?: Error;
  actualPort?: number;
} = {}) {
  const attempts: Array<{ port: number; host: string }> = [];
  const errors = new Set<(error: Error) => void>();
  let boundPort = 0;
  const server = {
    listen: vi.fn((port: number, host: string, callback: () => void) => {
      attempts.push({ port, host });
      options.onAttempt?.(port);
      const outcome = outcomes.get(port) ?? 'ok';
      queueMicrotask(() => {
        if (outcome === 'ok') {
          boundPort = options.actualPort ?? port;
          callback();
        } else {
          const error = Object.assign(new Error(outcome), { code: outcome });
          for (const listener of errors) listener(error);
        }
      });
      return server;
    }),
    on: vi.fn((event: string, listener: (error: Error) => void) => {
      if (event === 'error') errors.add(listener);
      return server;
    }),
    once: vi.fn((event: string, listener: (error: Error) => void) => {
      if (event === 'error') errors.add(listener);
      return server;
    }),
    off: vi.fn((event: string, listener: (error: Error) => void) => {
      if (event === 'error') errors.delete(listener);
      return server;
    }),
    removeListener: vi.fn((event: string, listener: (error: Error) => void) => {
      if (event === 'error') errors.delete(listener);
      return server;
    }),
    close: vi.fn((callback?: (error?: Error) => void) => {
      queueMicrotask(() => callback?.(options.closeError));
      return server;
    }),
    closeAllConnections: vi.fn(),
    address: vi.fn(() => ({ port: boundPort })),
  };
  httpFake.createServer.mockReturnValue(server);
  return { server, attempts };
}

function plan(candidates: readonly number[], strict = false, bindHost = '127.0.0.1'): ViewPlan {
  return {
    bindHost, candidates, strict, warn: false,
    reader: {
      list: async () => [],
      get: async () => ({ kind: 'not-found' }),
      bytes: async () => ({ kind: 'not-found' }),
      screenshot: async () => ({ kind: 'not-found' }),
    },
  };
}

function start(viewPlan: ViewPlan, signal: AbortSignal) {
  return startLocalReportServer(viewPlan, { signal, stderr: process.stderr });
}

beforeEach(() => httpFake.createServer.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('startLocalReportServer candidate binding', () => {
  it('tries occupied candidates in order and reports the successful port', async () => {
    const { attempts } = fakeServer(new Map([[4600, 'EADDRINUSE'], [4601, 'EADDRINUSE']]));
    const controller = new AbortController();
    const started = await start(plan([4600, 4601, 4602]), controller.signal);
    expect(attempts).toEqual([
      { port: 4600, host: '127.0.0.1' },
      { port: 4601, host: '127.0.0.1' },
      { port: 4602, host: '127.0.0.1' },
    ]);
    expect(started.url).toBe('http://127.0.0.1:4602/');
    controller.abort();
    await expect(started.closed).resolves.toBeUndefined();
  });

  it('uses the actual bound port returned by address()', async () => {
    const { server } = fakeServer(new Map(), { actualPort: 52731 });
    const controller = new AbortController();
    const started = await start(plan([0]), controller.signal);
    expect(server.address).toHaveBeenCalled();
    expect(started.url).toBe('http://127.0.0.1:52731/');
    controller.abort();
    await started.closed;
  });

  it('rejects an occupied strict port with its exact diagnostic and exit code', async () => {
    const { attempts } = fakeServer(new Map([[4600, 'EADDRINUSE']]));
    await expect(start(plan([4600], true), new AbortController().signal)).rejects.toMatchObject({
      message: 'Port 4600 on 127.0.0.1 is in use.',
      kind: 'port-unavailable', exitCode: 3,
      details: { host: '127.0.0.1', attempted: [4600] },
    });
    expect(attempts.map(({ port }) => port)).toEqual([4600]);
  });

  it('reports the complete attempted range after all candidates are occupied', async () => {
    const { attempts } = fakeServer(new Map([[65534, 'EADDRINUSE'], [65535, 'EADDRINUSE']]));
    const result = start(plan([65534, 65535]), new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(PortUnavailableError);
    await expect(result).rejects.toMatchObject({
      message: 'No free port in 65534-65535 on 127.0.0.1.',
      details: { host: '127.0.0.1', attempted: [65534, 65535] },
      exitCode: 3,
    });
    expect(attempts.map(({ port }) => port)).toEqual([65534, 65535]);
  });

  it('stops immediately on a non-EADDRINUSE bind error', async () => {
    const { attempts } = fakeServer(new Map([[4600, 'EACCES']]));
    await expect(start(plan([4600, 4601, 4602]), new AbortController().signal)).rejects.toMatchObject({
      message: 'Cannot bind 127.0.0.1:4600 (EACCES).',
      kind: 'port-unavailable', exitCode: 3,
      details: { host: '127.0.0.1', attempted: [4600], code: 'EACCES' },
    });
    expect(attempts.map(({ port }) => port)).toEqual([4600]);
  });
});

describe('startLocalReportServer abort lifecycle', () => {
  it('settles cleanly without listening when already aborted', async () => {
    const { server } = fakeServer(new Map());
    const controller = new AbortController();
    controller.abort();
    const started = await start(plan([4600]), controller.signal);
    expect(server.listen).not.toHaveBeenCalled();
    await expect(started.closed).resolves.toBeUndefined();
  });

  it('checks abort between occupied candidates before trying the next port', async () => {
    const controller = new AbortController();
    const { server, attempts } = fakeServer(new Map([[4600, 'EADDRINUSE'], [4601, 'EADDRINUSE']]), {
      onAttempt: (port) => { if (port === 4600) queueMicrotask(() => controller.abort()); },
    });
    const started = await start(plan([4600, 4601, 4602]), controller.signal);
    expect(attempts.map(({ port }) => port)).toEqual([4600]);
    expect(server.listen).toHaveBeenCalledTimes(1);
    await expect(started.closed).resolves.toBeUndefined();
  });

  it('closes the listener and all connections after a later abort', async () => {
    const { server } = fakeServer(new Map());
    const controller = new AbortController();
    const started = await start(plan([4600]), controller.signal);
    controller.abort();
    await expect(started.closed).resolves.toBeUndefined();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });

  it('fulfills closed even when close reports an error', async () => {
    const { server } = fakeServer(new Map(), { closeError: new Error('close failed') });
    const controller = new AbortController();
    const started = await start(plan([4600]), controller.signal);
    controller.abort();
    await expect(started.closed).resolves.toBeUndefined();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });
});
