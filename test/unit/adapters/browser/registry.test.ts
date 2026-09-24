import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UiExecutor } from '../../../../src/ports/browser.js';
import type { ResolvedUiExecutorConfig } from '../../../../src/core/config/schema.js';
import { UI_CAPABILITIES } from '#core/ir/capabilities.js';
import { BrowserLaunchFailedError } from '../../../../src/core/errors/browser-launch-failed-error.js';

const mocks = vi.hoisted(() => ({
  createPlaywrightUiExecutor: vi.fn(),
}));

vi.mock('../../../../src/adapters/browser/chromium.js', () => ({
  createPlaywrightUiExecutor: mocks.createPlaywrightUiExecutor,
}));

import { createUiExecutorResolver } from '../../../../src/adapters/browser/registry.js';

afterEach(() => {
  vi.resetAllMocks();
});

const config = { kind: 'playwright', browser: 'chromium' } as const;

function playwrightExecutor(): UiExecutor {
  return { kind: 'playwright', surface: 'web', capabilities: new Set(UI_CAPABILITIES), launch: vi.fn() };
}

describe('createUiExecutorResolver()', () => {
  it('resolves Playwright through its registered factory', () => {
    const executor = playwrightExecutor();
    mocks.createPlaywrightUiExecutor.mockReturnValue(executor);

    expect(createUiExecutorResolver()(config)).toBe(executor);
    expect(mocks.createPlaywrightUiExecutor).toHaveBeenCalledExactlyOnceWith(config, undefined);
  });

  it('forwards headed policy and declares all thirteen capabilities', () => {
    const executor = playwrightExecutor();
    mocks.createPlaywrightUiExecutor.mockReturnValue(executor);

    expect(createUiExecutorResolver({ headed: true })(config)).toBe(executor);
    expect(mocks.createPlaywrightUiExecutor).toHaveBeenCalledExactlyOnceWith(config, { headed: true });
    expect(executor).toMatchObject({ kind: 'playwright', surface: 'web' });
    expect([...executor.capabilities]).toEqual(UI_CAPABILITIES);
    expect(executor.capabilities.size).toBe(13);
  });

  it.each(['stagehand', ''] as const)('throws BrowserLaunchFailedError for unregistered kind %j', (kind) => {
    const resolver = createUiExecutorResolver();
    const unknown = { ...config, kind } as unknown as ResolvedUiExecutorConfig;

    expect(() => resolver(unknown)).toThrow(BrowserLaunchFailedError);
    expect(() => resolver(unknown)).toThrow(expect.objectContaining({
      details: { reason: 'executor-unregistered', engine: kind },
    }));
    expect(mocks.createPlaywrightUiExecutor).not.toHaveBeenCalled();
  });
});
