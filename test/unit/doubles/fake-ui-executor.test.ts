import { describe, expect, it } from 'vitest';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeBrowserSession } from '../../doubles/fake-browser-session.js';

const TARGET = { surface: 'web', baseUrl: 'https://example.test' } as const;

describe('createFakeUiExecutor', () => {
  it('declares the Playwright web executor and its capabilities', () => {
    const driver = createFakeUiExecutor(() => createFakeBrowserSession(new Map()));

    expect(driver.kind).toBe('playwright');
    expect(driver.surface).toBe('web');
    expect(driver.capabilities.size).toBe(13);
  });

  it('creates and returns a session from its factory when launched', async () => {
    const session = createFakeBrowserSession(new Map());
    let factoryCalls = 0;
    const driver = createFakeUiExecutor(() => {
      factoryCalls += 1;
      return session;
    });

    await expect(driver.launch(TARGET)).resolves.toBe(session);
    expect(factoryCalls).toBe(1);
  });
});
