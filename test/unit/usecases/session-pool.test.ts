// Advisory reads can inspect acquired sessions without changing lazy browser startup.
import { describe, expect, it, vi } from 'vitest';
import { createSessionPool } from '#usecases/session-pool.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeBrowserSession, RESOLVED_TARGETS, TARGETS } from '../../support/run-scenario.js';
import type { BrowserSession } from '#ports/browser.js';

describe('SessionPool.peek', () => {
  function scenario(factory = () => createFakeBrowserSession(new Map())) {
    const launch = vi.fn(factory);
    const executor = createFakeUiExecutor(launch);
    const target = { definition: TARGETS.web, config: RESOLVED_TARGETS.web };
    return { pool: createSessionPool({ web: target, other: target }, { web: executor, other: executor }), launch };
  }

  it('returns undefined before acquisition without launching any target', () => {
    const { pool, launch } = scenario();
    expect(pool.peek('web')).toBeUndefined();
    expect(pool.peek('other')).toBeUndefined();
    expect(pool.peek('unknown')).toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });

  it('returns the session only for the acquired target', async () => {
    const { pool, launch } = scenario();
    const session = await pool.acquire('web');
    expect(pool.peek('web')).toBe(session);
    expect(pool.peek('other')).toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
    await pool.closeAll();
  });

  it('keeps a failed launch absent and leaves other names unaffected', async () => {
    const { pool, launch } = scenario(() => { throw new Error('Launch failed.'); });
    await expect(pool.acquire('web')).rejects.toThrow('Launch failed.');
    expect(pool.peek('web')).toBeUndefined();
    expect(pool.peek('other')).toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('returns undefined while launch is pending and the session after acquisition', async () => {
    let complete!: (session: BrowserSession) => void;
    const pending = new Promise<BrowserSession>(resolve => { complete = resolve; });
    const executor = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));
    executor.launch = vi.fn(() => pending);
    const target = { definition: TARGETS.web, config: RESOLVED_TARGETS.web };
    const pool = createSessionPool({ web: target }, { web: executor });
    const acquisition = pool.acquire('web');
    const session = createFakeBrowserSession(new Map());
    try {
      expect(pool.peek('web')).toBeUndefined();
    } finally {
      complete(session);
      await acquisition;
      await pool.closeAll();
    }
    expect(pool.peek('web')).toBe(session);
  });
});
