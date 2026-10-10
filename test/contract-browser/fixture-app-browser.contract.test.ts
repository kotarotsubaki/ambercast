import { chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import { computeAccessibilityFingerprint, matchQuotedCandidates } from '#core/ir/fingerprint.js';
import { isSnapshotInvalid, type AccessibilityNode } from '#core/ir/aria-snapshot.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import {
  DELAY_LOWER_SLACK_MS, DELAY_UPPER_SLACK_MS, FIXTURE_CREDENTIALS,
  SESSION_COOKIE_NAME, startFixtureApp, type FixtureApp,
} from './support/fixture-app.js';

declare global {
  interface Window {
    __fixtureEvents: { name: string; atMs: number }[];
    __sameDocument?: boolean;
  }
}

async function withPage(check: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await check(page);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function assertDelay(page: Page, start: string, end: string, delayMs: number): Promise<void> {
  await page.waitForFunction((name) => window.__fixtureEvents.some((event) => event.name === name), end);
  const events = await page.evaluate(() => window.__fixtureEvents);
  const starts = events.filter((event) => event.name === start);
  const ends = events.filter((event) => event.name === end);
  expect(starts).toHaveLength(1);
  expect(ends).toHaveLength(1);
  const delta = ends[0]!.atMs - starts[0]!.atMs;
  expect(delta).toBeGreaterThanOrEqual(delayMs - DELAY_LOWER_SLACK_MS);
  expect(delta).toBeLessThanOrEqual(delayMs + DELAY_UPPER_SLACK_MS);
}

function operableNodes(tree: AccessibilityNode): { role: string; name: string }[] {
  const nodes: { role: string; name: string }[] = [];
  function visit(node: AccessibilityNode): void {
    if (['button', 'link', 'textbox'].includes(node.role)) nodes.push({ role: node.role, name: node.name });
    for (const child of node.children) visit(child);
  }
  visit(tree);
  return nodes;
}

describe('fixture app browser building blocks', () => {
  let app: FixtureApp;
  let chromiumAvailable = false;

  beforeAll(async () => {
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
    app = await startFixtureApp();
  });
  afterAll(async () => { await app?.stop(); });
  beforeEach((context) => {
    if (!chromiumAvailable) {
      context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
    }
    app.reset();
  });

  describe('client-side transition', () => {
    it('TEST-11 pushes history in the same document before the delayed detail render', async () => {
      app.configure({ transitionDelayMs: 300 });
      await withPage(async (page) => {
        await page.goto(app.url('/spa'));
        await page.evaluate(() => { window.__sameDocument = true; });
        await page.getByRole('link', { name: 'Open item 1', exact: true }).click();
        expect(new URL(page.url()).pathname).toBe('/spa/items/1');
        expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
        await assertDelay(page, 'transition-start:1', 'detail-rendered:1', 300);
        expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Item 1 detail');
      });
    });

    it('TEST-11 delays a direct detail load without recording a link transition', async () => {
      app.configure({ transitionDelayMs: 200 });
      await withPage(async (page) => {
        await page.goto(app.url('/spa/items/2'));
        await page.getByRole('heading', { level: 1, name: 'Item 2 detail', exact: true }).waitFor();
        await assertDelay(page, 'script-start', 'detail-rendered:2', 200);
        expect((await page.evaluate(() => window.__fixtureEvents)).some((event) => event.name.startsWith('transition-start:'))).toBe(false);
      });
    });

    it('TEST-11 tears down the list immediately into a busy shell', async () => {
      app.configure({ transitionDelayMs: 2000 });
      await withPage(async (page) => {
        await page.goto(app.url('/spa'));
        await page.getByRole('link', { name: 'Open item 1', exact: true }).click();
        expect(await page.getByRole('heading', { level: 1, name: 'Item 1 detail', exact: true }).count()).toBe(0);
        expect(await page.getByRole('heading', { level: 1, name: 'Items', exact: true }).count()).toBe(0);
        expect(await page.locator('main').getAttribute('aria-busy')).toBe('true');
      });
    });

    it('TEST-11 renders a zero-delay transition synchronously', async () => {
      app.configure({ transitionDelayMs: 0 });
      await withPage(async (page) => {
        await page.goto(app.url('/spa'));
        await page.getByRole('link', { name: 'Open item 1', exact: true }).click();
        expect(await page.getByRole('heading', { level: 1, name: 'Item 1 detail', exact: true }).count()).toBe(1);
      });
    });

    it('TEST-11 cancels a pending detail render on popstate', async () => {
      app.configure({ transitionDelayMs: 300 });
      await withPage(async (page) => {
        await page.goto(app.url('/spa'));
        await page.getByRole('link', { name: 'Open item 1', exact: true }).click();
        expect(await page.locator('main').getAttribute('aria-busy')).toBe('true');
        await page.goBack();
        // Waiting past the cancelled timer detects a stale callback replacing the list.
        await page.waitForTimeout(400);
        expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Items');
        expect(await page.locator('main').getAttribute('aria-busy')).toBeNull();
        const events = await page.evaluate(() => window.__fixtureEvents);
        expect(events.some((event) => event.name === 'detail-rendered:1')).toBe(false);
        expect(events.filter((event) => event.name.startsWith('transition-start:')).map((event) => event.name)).toEqual(['transition-start:1']);
      });
    });

    it('TEST-11 restores detail through history after Back to list pushes the list', async () => {
      app.configure({ transitionDelayMs: 0 });
      await withPage(async (page) => {
        await page.goto(app.url('/spa'));
        await page.getByRole('link', { name: 'Open item 1', exact: true }).click();
        expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Item 1 detail');
        await page.getByRole('link', { name: 'Back to list', exact: true }).click();
        expect(new URL(page.url()).pathname).toBe('/spa');
        expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Items');
        await page.goBack();
        expect(new URL(page.url()).pathname).toBe('/spa/items/1');
        expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Item 1 detail');
      });
    });
  });

  describe('late element', () => {
    it('TEST-12 inserts the action after the configured browser delay', async () => {
      app.configure({ lateElementDelayMs: 400 });
      await withPage(async (page) => {
        await page.goto(app.url('/late'));
        await assertDelay(page, 'script-start', 'late-inserted', 400);
        expect(await page.getByRole('button', { name: 'Late action', exact: true }).count()).toBe(1);
      });
    });
    it('TEST-12 initially has no accessible Late action button', async () => {
      app.configure({ lateElementDelayMs: 2000 });
      await withPage(async (page) => {
        await page.goto(app.url('/late'));
        expect(await page.getByRole('button', { name: 'Late action', exact: true }).count()).toBe(0);
      });
    });
    it('TEST-12 inserts synchronously at zero delay and handles the action', async () => {
      app.configure({ lateElementDelayMs: 0 });
      await withPage(async (page) => {
        await page.goto(app.url('/late'));
        const button = page.getByRole('button', { name: 'Late action', exact: true });
        expect(await button.count()).toBe(1);
        await button.click();
        expect(await page.locator('#result').textContent()).toBe('Late action done');
      });
    });
  });

  describe('ready gate', () => {
    it('TEST-13 enables after the configured delay and receives a click', async () => {
      app.configure({ readyDelayMs: 400 });
      await withPage(async (page) => {
        await page.goto(app.url('/ready'));
        await assertDelay(page, 'script-start', 'ready-enabled', 400);
        const button = page.getByRole('button', { name: 'Continue', exact: true });
        expect(await button.isEnabled()).toBe(true);
        await button.click();
        expect(await page.locator('#result').textContent()).toBe('Continued');
        expect((await page.evaluate(() => window.__fixtureEvents)).some((event) => event.name === 'click-received')).toBe(true);
      });
    });
    it('TEST-13 ignores even a forced click while disabled', async () => {
      app.configure({ readyDelayMs: 2000 });
      await withPage(async (page) => {
        await page.goto(app.url('/ready'));
        const button = page.getByRole('button', { name: 'Continue', exact: true });
        expect(await button.isDisabled()).toBe(true);
        await button.click({ force: true });
        expect((await page.evaluate(() => window.__fixtureEvents)).some((event) => event.name === 'click-received')).toBe(false);
        expect(await page.locator('#result').textContent()).toBe('');
      });
    });
    it('TEST-13 has no disabled attribute at zero delay and is immediately clickable', async () => {
      app.configure({ readyDelayMs: 0 });
      await withPage(async (page) => {
        await page.goto(app.url('/ready'));
        const button = page.getByRole('button', { name: 'Continue', exact: true });
        expect(await button.getAttribute('disabled')).toBeNull();
        await button.click();
        expect(await page.locator('#result').textContent()).toBe('Continued');
      });
    });
  });

  describe('label override', () => {
    it('TEST-14 fixes accessible labels at load while preserving result text and literal markup', async () => {
      await withPage(async (page) => {
        await page.goto(app.url('/label'));
        const original = await page.locator('body').ariaSnapshot();
        expect(original).toContain('button "Submit"');
        expect(original).not.toContain('button "Send"');
        await page.getByRole('button', { name: 'Submit', exact: true }).click();
        expect(await page.locator('#result').textContent()).toBe('Submitted');
        app.configure({ labelOverrides: { submit: 'Send' } });
        const unchanged = await page.locator('body').ariaSnapshot();
        expect(unchanged).toContain('button "Submit"');
        expect(unchanged).not.toContain('button "Send"');
        await page.reload();
        const changed = await page.locator('body').ariaSnapshot();
        expect(changed).toContain('button "Send"');
        expect(changed).not.toContain('button "Submit"');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        expect(await page.locator('#result').textContent()).toBe('Submitted');
        const literal = 'A & <b>x</b> "q" \'r\'';
        app.configure({ labelOverrides: { submit: literal } });
        await page.reload();
        expect(await page.getByRole('button', { name: literal, exact: true }).count()).toBe(1);
        expect(await page.getByRole('button').locator('b').count()).toBe(0);
      });
    });
  });

  describe('accessible names resolve through quoted match', () => {
    it('TEST-15 uniquely matches every operable name through production snapshots', async () => {
      const session = await createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }).launch({ surface: 'web', baseUrl: app.baseUrl });
      try {
        const pages: { path: string; pairs: [string, string][] }[] = [
          { path: '/', pairs: [['link', 'SPA'], ['link', 'Late element'], ['link', 'Ready gate'], ['link', 'Label page'], ['link', 'Login']] },
          { path: '/spa', pairs: [['link', 'Open item 1'], ['link', 'Open item 2']] },
          { path: '/spa/items/1', pairs: [['button', 'Archive item 1'], ['link', 'Back to list']] },
          { path: '/spa/items/2', pairs: [['button', 'Archive item 2'], ['link', 'Back to list']] },
          { path: '/late', pairs: [['button', 'Late action']] },
          { path: '/ready', pairs: [['button', 'Continue']] },
          { path: '/label', pairs: [['button', 'Submit']] },
          { path: '/login', pairs: [['textbox', 'Username'], ['textbox', 'Passcode'], ['button', 'Sign in']] },
        ];
        for (const { path, pairs } of pages) {
          if (path === '/late') app.configure({ lateElementDelayMs: 0 });
          if (path === '/ready') app.configure({ readyDelayMs: 0 });
          await session.perform({ type: 'navigate', url: app.url(path) });
          const { tree } = await session.accessibilitySnapshot();
          expect(isSnapshotInvalid(tree), path).toBe(false);
          for (const [role, name] of pairs) {
            const matches = matchQuotedCandidates(tree as AccessibilityNode, { text: name, roleHint: role });
            expect(Array.isArray(matches), `${path}: ${name}`).toBe(true);
            if (!Array.isArray(matches)) throw new Error(`Invalid snapshot for ${path}`);
            expect(matches, `${path}: ${name}`).toEqual([{ role, name }]);
            expect(computeAccessibilityFingerprint(tree, { strategy: 'accessibility', role, name }, []).kind, `${path}: ${name}`).toBe('ok');
          }
          const names = operableNodes(tree as AccessibilityNode).map((node) => node.name);
          expect(new Set(names).size, path).toBe(names.length);
        }
      } finally {
        await session.close();
      }
    });

    it('TEST-15 preserves a disabled action name in the production snapshot', async () => {
      app.configure({ readyDelayMs: 2000 });
      const session = await createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }).launch({ surface: 'web', baseUrl: app.baseUrl });
      try {
        await session.perform({ type: 'navigate', url: app.url('/ready') });
        const { tree } = await session.accessibilitySnapshot();
        expect(isSnapshotInvalid(tree)).toBe(false);
        expect(matchQuotedCandidates(tree as AccessibilityNode, { text: 'Continue', roleHint: 'button' })).toEqual([{ role: 'button', name: 'Continue' }]);
      } finally {
        await session.close();
      }
    });

    it('TEST-15 accepts an empty busy shell as a valid production snapshot', async () => {
      app.configure({ transitionDelayMs: 2000 });
      const session = await createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' }).launch({ surface: 'web', baseUrl: app.baseUrl });
      try {
        await session.perform({ type: 'navigate', url: app.url('/spa/items/1') });
        const { tree } = await session.accessibilitySnapshot();
        expect(isSnapshotInvalid(tree)).toBe(false);
        expect(operableNodes(tree as AccessibilityNode)).toEqual([]);
      } finally {
        await session.close();
      }
    });
  });

  describe('login in a real browser', () => {
    it('TEST-16 authenticates, isolates contexts, rejects invalid credentials, and invalidates stale cookies', async () => {
      const browser = await chromium.launch();
      try {
        const authenticated = await browser.newContext();
        try {
          const page = await authenticated.newPage();
          await page.goto(app.url('/login'));
          await page.getByRole('textbox', { name: 'Username', exact: true }).fill(FIXTURE_CREDENTIALS.username);
          await page.getByRole('textbox', { name: 'Passcode', exact: true }).fill(FIXTURE_CREDENTIALS.passcode);
          await Promise.all([
            page.waitForURL(app.url('/dashboard')),
            page.getByRole('button', { name: 'Sign in', exact: true }).click(),
          ]);
          expect(new URL(page.url()).pathname).toBe('/dashboard');
          expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Dashboard');
          const cookies = (await authenticated.cookies()).filter((cookie) => cookie.name === SESSION_COOKIE_NAME);
          expect(cookies).toHaveLength(1);
          expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

          const anonymous = await browser.newContext();
          try {
            const anonymousPage = await anonymous.newPage();
            await anonymousPage.goto(app.url('/dashboard'));
            expect(new URL(anonymousPage.url()).pathname).toBe('/login');
          } finally {
            await anonymous.close();
          }

          const rejected = await browser.newContext();
          try {
            const rejectedPage = await rejected.newPage();
            await rejectedPage.goto(app.url('/login'));
            await rejectedPage.getByRole('textbox', { name: 'Username', exact: true }).fill(FIXTURE_CREDENTIALS.username);
            await rejectedPage.getByRole('textbox', { name: 'Passcode', exact: true }).fill('wrong-passcode');
            await Promise.all([
              rejectedPage.waitForEvent('framenavigated', (frame) => frame === rejectedPage.mainFrame()),
              rejectedPage.getByRole('button', { name: 'Sign in', exact: true }).click(),
            ]);
            expect(new URL(rejectedPage.url()).pathname).toBe('/login');
            expect(await rejectedPage.getByRole('alert').textContent()).toBe('Invalid credentials');
          } finally {
            await rejected.close();
          }

          app.reset();
          await page.goto(app.url('/dashboard'));
          expect(new URL(page.url()).pathname).toBe('/login');
        } finally {
          await authenticated.close();
        }
      } finally {
        await browser.close();
      }
    });
  });
});
