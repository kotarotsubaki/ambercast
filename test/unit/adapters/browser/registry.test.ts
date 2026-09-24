import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UiExecutor } from '../../../../src/ports/browser.js';
import { UI_CAPABILITIES } from '#core/ir/capabilities.js';

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
    expect(mocks.createPlaywrightUiExecutor).toHaveBeenCalledExactlyOnceWith(config, { headed: false });
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

  it('uses the override factory for a configured kind', () => {
    const executor = playwrightExecutor();
    const overrideSpy = vi.fn().mockReturnValue(executor);
    mocks.createPlaywrightUiExecutor.mockReturnValue(playwrightExecutor());

    expect(createUiExecutorResolver({ headed: true, factories: { playwright: overrideSpy } })(config)).toBe(executor);
    expect(overrideSpy).toHaveBeenCalledExactlyOnceWith(config, { headed: true });
    expect(mocks.createPlaywrightUiExecutor).not.toHaveBeenCalled();
  });

  it('uses the default factory when overrides are omitted', () => {
    const executor = playwrightExecutor();
    mocks.createPlaywrightUiExecutor.mockReturnValue(executor);

    expect(createUiExecutorResolver({ headed: true })(config)).toBe(executor);
    expect(mocks.createPlaywrightUiExecutor).toHaveBeenCalledExactlyOnceWith(config, { headed: true });
  });
});
