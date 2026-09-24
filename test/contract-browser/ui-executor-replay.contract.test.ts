import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import type { UiExecutorFactory } from '#adapters/browser/registry.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import type { ElementRef, JsonValueT, TargetDefinition } from '#core/ir/schema.js';
import type { UiExecutorReplayHarness } from '../contracts/ui-executor-replay.contract.js';
import { registerUiExecutorReplayContract } from '../contracts/ui-executor-replay.contract.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';

const ELEMENT = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const satisfies ElementRef;
const READY_TEXT = 'Ready';
let chromiumAvailable = false;
let port = 0;
let responseText: 'Alpha' | 'Beta' = 'Alpha';

function fixtureHtml(text: 'Alpha' | 'Beta'): string {
  return `<!doctype html><html lang="en"><body><main aria-label="Application"><button type="button">Submit</button>${text}</main><p id="result"></p><script>document.querySelector('button').addEventListener('click', () => { document.querySelector('#result').textContent = '${READY_TEXT}'; });</script></body></html>`;
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(fixtureHtml(responseText));
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The replay fixture server did not expose a TCP address.');
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

beforeAll(async () => {
  chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  if (chromiumAvailable) port = await listen(server);
});

beforeEach((context) => {
  responseText = 'Alpha';
  if (!chromiumAvailable) {
    context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
  }
});

afterAll(async () => {
  await closeServer(server);
});

const factoryFor = (text: 'Alpha' | 'Beta'): UiExecutorFactory => (executor, options) => {
  responseText = text;
  return createPlaywrightUiExecutor(executor, options);
};

const harness: UiExecutorReplayHarness = {
  get target(): TargetDefinition {
    return { surface: 'web', baseUrl: `http://127.0.0.1:${port}` };
  },
  get entryUrl(): string {
    return `http://127.0.0.1:${port}/`;
  },
  element: ELEMENT,
  readyText: READY_TEXT,
  producerFactory: factoryFor('Alpha'),
  sameObservationFactory: factoryFor('Alpha'),
  divergentObservationFactory: factoryFor('Beta'),
};

function buttonSiblingText(tree: JsonValueT): string | undefined {
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) return undefined;
  const children = tree.children;
  if (Array.isArray(children)) {
    const buttonIndex = children.findIndex((child) =>
      child !== null && typeof child === 'object' && !Array.isArray(child)
      && child.role === 'button' && child.name === 'Submit');
    if (buttonIndex >= 0) {
      const sibling = children[buttonIndex + 1];
      if (sibling !== null && typeof sibling === 'object' && !Array.isArray(sibling)
        && sibling.role === 'text' && typeof sibling.name === 'string') return sibling.name;
    }
    for (const child of children) {
      const found = buttonSiblingText(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe('ui-executor replay contract (browser)', () => {
  it('observes adjacent sibling text and distinct fingerprints in real Chromium trees', async () => {
    const hashes: string[] = [];
    for (const text of ['Alpha', 'Beta'] as const) {
      responseText = text;
      const session = await createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }).launch(harness.target);
      try {
        await session.perform({ type: 'navigate', url: harness.entryUrl });
        const tree = (await session.snapshotForResolution()).accessibilityTree;
        expect(buttonSiblingText(tree)).toBe(text);
        const result = computeAccessibilityFingerprint(tree, ELEMENT, []);
        expect(result.kind).toBe('ok');
        if (result.kind === 'ok') hashes.push(result.fingerprint.hash);
      } finally {
        await session.close();
      }
    }
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  registerUiExecutorReplayContract(harness);
});
