import { describe, expect, it } from 'vitest';
import type { UiExecutor } from '../../src/ports/browser.js';
import { UI_CAPABILITIES } from '#core/ir/capabilities.js';

export interface UiExecutorContractHarness {
  createExecutor(): UiExecutor | Promise<UiExecutor>;
  dispose?(): void | Promise<void>;
}

const TARGET = { surface: 'web', baseUrl: 'https://example.test' } as const;

export function registerUiExecutorContract(harness: UiExecutorContractHarness): void {
  describe('UiExecutor contract', () => {
    it('declares kind, surface, and all supported capabilities', async () => {
      try {
        const executor = await harness.createExecutor();
        expect(executor.kind).toBe('playwright');
        expect(executor.surface).toBe('web');
        expect(executor.capabilities).toBeInstanceOf(Set);
        expect([...executor.capabilities]).toEqual(UI_CAPABILITIES);
      } finally {
        await harness.dispose?.();
      }
    });

    it('launches a working browser session', async () => {
      let session: Awaited<ReturnType<UiExecutor['launch']>> | undefined;

      try {
        const executor = await harness.createExecutor();
        session = await executor.launch(TARGET);

        expect(session).toMatchObject({
          perform: expect.any(Function),
          evaluateAssert: expect.any(Function),
          resolveGrounded: expect.any(Function),
          close: expect.any(Function),
        });
      } finally {
        try {
          await session?.close();
        } finally {
          await harness.dispose?.();
        }
      }
    });
  });
}
