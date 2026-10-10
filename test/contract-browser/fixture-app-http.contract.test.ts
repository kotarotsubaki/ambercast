import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupRegistry } from './support/cleanup-registry.js';
import {
  DELAY_LOWER_SLACK_MS,
  DELAY_UPPER_SLACK_MS,
  FIXTURE_CREDENTIALS,
  SESSION_COOKIE_NAME,
  startFixtureApp,
  type FixtureApp,
  type FixtureConfig,
  type StartFixtureAppOptions,
} from './support/fixture-app.js';

const CUSTOM_INDEX = '<h1>Custom</h1>';
const FORM_TYPE = 'application/x-www-form-urlencoded';
const VALID_FORM = new URLSearchParams(FIXTURE_CREDENTIALS).toString();

function request(app: FixtureApp, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(app.url(path), { ...init, redirect: 'manual' });
}

function login(app: FixtureApp, body = VALID_FORM, contentType = FORM_TYPE): Promise<Response> {
  return request(app, '/login', {
    method: 'POST', headers: { 'content-type': contentType }, body,
  });
}

function paddedForm(bytes: number): string {
  const prefix = `${VALID_FORM}&padding=`;
  const body = prefix + 'x'.repeat(bytes - Buffer.byteLength(prefix));
  expect(Buffer.byteLength(body)).toBe(bytes);
  return body;
}

async function measuredRequest(
  app: FixtureApp, path: string, init: RequestInit = {},
): Promise<{ response: Response; elapsed: number }> {
  const start = performance.now();
  const response = await request(app, path, init);
  return { response, elapsed: performance.now() - start };
}

function expectDelay(elapsed: number, delay: number): void {
  expect(elapsed).toBeGreaterThanOrEqual(delay - DELAY_LOWER_SLACK_MS);
  expect(elapsed).toBeLessThanOrEqual(delay + DELAY_UPPER_SLACK_MS);
}

async function expectClosed(port: number): Promise<void> {
  const error = await new Promise<Error & { code?: string }>((resolve, reject) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Closed-port probe did not settle.'));
    }, 1000);
    socket.once('error', (failure) => {
      clearTimeout(timer);
      resolve(failure);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error('The fixture port still accepts connections.'));
    });
  });
  expect(error.code).toBe('ECONNREFUSED');
}

async function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const onError = (error: Error): void => reject(error);
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

// Connection-close framing makes raw responses observable without a second HTTP parser.
function collectRaw(socket: Socket, onHeaders?: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Raw HTTP connection did not close.'));
    }, 2000);
    let headersSeen = false;
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (!headersSeen && Buffer.concat(chunks).includes('\r\n\r\n')) {
        headersSeen = true;
        onHeaders?.();
      }
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') {
        clearTimeout(timer);
        reject(error);
      }
    });
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function rawRequest(port: number, bytes: string): Promise<string> {
  const socket = await openSocket(port);
  const result = collectRaw(socket);
  socket.write(bytes);
  return result;
}

function rawResponse(bytes: string): { status: number; headers: Headers; body: string } {
  const boundary = bytes.indexOf('\r\n\r\n');
  expect(boundary).toBeGreaterThanOrEqual(0);
  const lines = bytes.slice(0, boundary).split('\r\n');
  const status = /^HTTP\/1\.[01] (\d{3})\b/.exec(lines.shift() ?? '');
  expect(status).not.toBeNull();
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(':');
    expect(colon).toBeGreaterThan(0);
    headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return { status: Number(status?.[1]), headers, body: bytes.slice(boundary + 4) };
}

function expectHtmlHeaders(headers: Headers): void {
  expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(headers.get('cache-control')).toBe('no-store');
}

function expectButton(html: string, text: string): void {
  expect(html).toMatch(new RegExp(`<button\\b[^>]*>\\s*${text}\\s*</button>`));
}

let sharedInstance: FixtureApp;
beforeAll(async () => { sharedInstance = await startFixtureApp(); });
afterAll(async () => { if (sharedInstance !== undefined) await sharedInstance.stop(); });
beforeEach(() => { sharedInstance.reset(); });
const getApp = (): FixtureApp => sharedInstance;

describe('fixture app lifecycle', () => {
  it('TEST-1 allows navigation-only segments and lengths while rejecting non-string paths', () => {
    const app = getApp();
    expect(() => app.url(123 as unknown as string)).toThrow(TypeError);
    for (const path of ['/a/./b', '/a/../b', '/' + 'a'.repeat(500)]) {
      expect(() => app.url(path)).not.toThrow();
      expect(app.url(path)).toBe(app.baseUrl + path);
    }
  });

  it('TEST-1 starts independent loopback instances and validates navigation paths', async () => {
    const first = await startFixtureApp();
    let second: FixtureApp | undefined;
    try {
      second = await startFixtureApp();
      for (const app of [first, second]) {
        expect(app.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/);
        expect(Number(new URL(app.baseUrl).port)).toBe(app.port);
        const response = await request(app, '/');
        expect(response.status).toBe(200);
        expectHtmlHeaders(response.headers);
        await response.text();
        expect(app.url('/late')).toBe(`${app.baseUrl}/late`);
        expect(app.url('/late?x=1')).toBe(`${app.baseUrl}/late?x=1`);
        for (const path of ['late', '/a#b', '/a b']) {
          expect(() => app.url(path)).toThrow(RangeError);
        }
      }
      expect(first.port).not.toBe(second.port);
      const lateUrl = first.url('/late');
      await first.stop();
      expect(first.url('/late')).toBe(lateUrl);
      await expect(async () => startFixtureApp(null as unknown as StartFixtureAppOptions))
        .rejects.toThrow(TypeError);
      await expect(async () => startFixtureApp({ registry: {} } as StartFixtureAppOptions))
        .rejects.toThrow(TypeError);
    } finally {
      await first.stop();
      await second?.stop();
    }
  });

  it('TEST-2 stops idempotently and discards delayed responses promptly', async () => {
    const app = await startFixtureApp();
    try {
      await expect(app.stop()).resolves.toBeUndefined();
      await expect(app.stop()).resolves.toBeUndefined();
      await expectClosed(app.port);
    } finally {
      await app.stop();
    }

    const delayed = await startFixtureApp();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      delayed.configure({ responseDelayMs: { '*': 30000 } });
      // Attach rejection handling before stop can tear down the pending client.
      const pending = request(delayed, '/').then(
        (response) => ({ ok: true as const, response }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.waitFor(() => { expect(delayed.inflight()).toBe(1); });
      const start = performance.now();
      await Promise.race([
        delayed.stop(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Stop exceeded 1000ms.')), 1000);
        }),
      ]);
      expect(performance.now() - start).toBeLessThan(1000);
      expect((await pending).ok).toBe(false);
    } finally {
      clearTimeout(deadline);
      await delayed.stop();
    }
  });

  it('TEST-3 delegates shutdown to the registry without leaking listening sockets', async () => {
    const listeningServers = (): number => process.getActiveResourcesInfo()
      .filter((resource) => resource === 'TCPServerWrap').length;
    const before = listeningServers();
    const registry = createCleanupRegistry();
    const port = await registry.run(async () => {
      const app = await startFixtureApp({ registry });
      const response = await request(app, '/');
      expect(response.status).toBe(200);
      await response.text();
      return app.port;
    });
    await expectClosed(port);

    const failingRegistry = createCleanupRegistry();
    const original = new Error('Fixture operation failed.');
    let failingPort: number | undefined;
    await expect(failingRegistry.run(async () => {
      const app = await startFixtureApp({ registry: failingRegistry });
      failingPort = app.port;
      throw original;
    })).rejects.toBe(original);
    expect(failingPort).toBeDefined();
    await expectClosed(failingPort!);

    const sealedRegistry = createCleanupRegistry();
    await sealedRegistry.run(async () => undefined);
    await expect(async () => startFixtureApp({ registry: sealedRegistry }))
      .rejects.toThrow('Cleanup registry registration is sealed after the operation settles.');
    await vi.waitFor(() => { expect(listeningServers()).toBe(before); });
  });
});

describe('fixture app routing', () => {

  it('TEST-4 serves the route table and gates methods and malformed request targets', async () => {
    const app = getApp();
    for (const [path, heading] of [
      ['/', 'Fixture index'], ['/late', 'Late element page'], ['/ready', 'Ready gate page'],
      ['/label', 'Label page'], ['/login', 'Account access'],
    ]) {
      const response = await request(app, path!);
      expect(response.status).toBe(200);
      expect(await response.text()).toMatch(new RegExp(`<h1\\b[^>]*>${heading}</h1>`));
    }
    for (const [path, title] of [
      ['/spa', 'Items'], ['/spa/items/1', 'Item 1 detail'], ['/spa/items/2', 'Item 2 detail'],
    ]) {
      const response = await request(app, path!);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<main id="root"');
      expect(html).toContain(`<title>${title}</title>`);
    }
    const dashboard = await request(app, '/dashboard');
    expect(dashboard.status).toBe(302);
    expect(dashboard.headers.get('location')).toBe('/login');
    expect(await dashboard.text()).toBe('');
    for (const path of ['/spa/items/3', '/nope', '/late/']) {
      const response = await request(app, path);
      expect(response.status).toBe(404);
      await response.text();
    }
    const query = await request(app, '/late?x=1');
    expect(query.status).toBe(200);
    await query.text();
    for (const [path, method, allow] of [
      ['/', 'POST', 'GET, HEAD'], ['/login', 'PUT', 'GET, HEAD, POST'],
    ]) {
      const response = await request(app, path!, { method: method! });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe(allow);
      expect(await response.text()).toBe('');
    }
    const get = await request(app, '/late');
    expectHtmlHeaders(get.headers);
    await get.text();
    const head = await request(app, '/late', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expectHtmlHeaders(head.headers);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const unknownPost = await request(app, '/nope', { method: 'POST' });
    expect(unknownPost.status).toBe(404);
    await unknownPost.text();

    app.reset();
    app.configure({ responseDelayMs: { '*': 600 } });
    const malformedSocket = await openSocket(app.port);
    let headerElapsed = Infinity;
    const start = performance.now();
    const malformedBytes = collectRaw(malformedSocket, () => {
      headerElapsed = performance.now() - start;
    });
    malformedSocket.write('GET //late HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    const malformed = rawResponse(await malformedBytes);
    expect(headerElapsed).toBeLessThanOrEqual(DELAY_UPPER_SLACK_MS);
    expect(malformed.status).toBe(400);
    expect(malformed.body).toBe('');
    expectHtmlHeaders(malformed.headers);
    expect(app.requestCount('/late')).toBe(0);
    const broken = await rawRequest(app.port,
      'GET http://[ HTTP/1.1\r\nConnection: close\r\n\r\n');
    if (broken !== '') expect(rawResponse(broken).status).toBe(400);
    expect(app.requestCount('/late')).toBe(0);
  });

  it('TEST-5 overrides pages atomically and restores built-in pages on reset', async () => {
    const app = getApp();
    app.setPage('/', CUSTOM_INDEX);
    const index = await request(app, '/');
    expect(index.status).toBe(200);
    expect(await index.text()).toBe(CUSTOM_INDEX);
    app.setPage('/login', '<h1>Custom login</h1>');
    const overriddenLogin = await login(app);
    expect(overriddenLogin.status).toBe(405);
    expect(await overriddenLogin.text()).toBe('');
    app.setPage('/dashboard', '<h1>Custom dashboard</h1>');
    const dashboard = await request(app, '/dashboard');
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toBe('<h1>Custom dashboard</h1>');
    app.setPage('/x', 'first');
    app.setPage('/x', 'second');
    expect(await (await request(app, '/x')).text()).toBe('second');
    const oversized = await login(app, paddedForm(4097));
    expect(oversized.status).toBe(405);
    expect(oversized.headers.get('allow')).toBe('GET, HEAD');
    expect(await oversized.text()).toBe('');
    for (const path of [
      '/a/../label', '//late', '/a/./b', 'x', '/a?b', '/a b', '/a%20b', '/é',
      '/' + 'a'.repeat(200),
    ]) {
      expect(() => app.setPage(path, 'x')).toThrow(RangeError);
      expect(await (await request(app, '/')).text()).toBe(CUSTOM_INDEX);
    }
    expect(() => app.setPage('/x', 123 as unknown as string)).toThrow(TypeError);
    expect(await (await request(app, '/')).text()).toBe(CUSTOM_INDEX);
    expect(await (await request(app, '/x')).text()).toBe('second');
    app.setPage('/empty', '');
    const empty = await request(app, '/empty');
    expect(empty.status).toBe(200);
    expect(await empty.text()).toBe('');
    app.setPage('/unicode', '<p>日本語 🎉</p>');
    expect(await (await request(app, '/unicode')).text()).toBe('<p>日本語 🎉</p>');
    app.reset();
    expect(await (await request(app, '/')).text()).toContain('Fixture index');
  });
});

describe('fixture app configuration', () => {

  it('TEST-6 distinguishes non-string labels from invalid string values', () => {
    const app = getApp();
    expect(() => app.configure({ labelOverrides: { submit: 1 as unknown as string } }))
      .toThrow(TypeError);
  });

  it('TEST-6 bounds emoji labels by UTF-16 length', async () => {
    const app = getApp();
    const accepted = '😀'.repeat(40);
    const rejected = '😀'.repeat(41);
    expect(accepted.length).toBe(80);
    expect(rejected.length).toBe(82);
    expect(() => app.configure({ labelOverrides: { submit: accepted } })).not.toThrow();
    expectButton(await (await request(app, '/label')).text(), accepted);
    expect(() => app.configure({ labelOverrides: { submit: rejected } })).toThrow(RangeError);
    expectButton(await (await request(app, '/label')).text(), accepted);
  });

  it('TEST-6 accepts a nested response-delay Map without applying its entries', async () => {
    const app = getApp();
    app.setPage('/x', '<h1>Undelayed</h1>');
    expect(() => app.configure({
      responseDelayMs: new Map([['/x', 100]]) as unknown as Record<string, number>,
    })).not.toThrow();
    const result = await measuredRequest(app, '/x');
    expect(result.response.status).toBe(200);
    expect(result.elapsed).toBeLessThan(100 - DELAY_LOWER_SLACK_MS);
    expect(await result.response.text()).toBe('<h1>Undelayed</h1>');
  });

  it('TEST-6 validates configuration atomically and copies and replaces caller maps', async () => {
    const app = getApp();
    const pageSnapshot = async (): Promise<string[]> => Promise.all(
      ['/spa', '/late', '/ready', '/label'].map(async (path) =>
        (await request(app, path)).text()),
    );
    const defaults = await pageSnapshot();
    const known = {
      transitionDelayMs: 111, lateElementDelayMs: 222, readyDelayMs: 333,
      labelOverrides: { submit: 'Send' }, responseDelayMs: { '/probe': 444 },
    };
    app.configure(known);
    app.setPage('/probe', '<h1>Probe</h1>');
    const configured = await pageSnapshot();
    expect(configured[0]).not.toBe(defaults[0]);
    expect(configured[1]).not.toBe(defaults[1]);
    expect(configured[2]).not.toBe(defaults[2]);
    expect(configured[0]).toMatch(/\b111\b/);
    expect(configured[1]).toMatch(/\b222\b/);
    expect(configured[2]).toMatch(/\b333\b/);
    expectButton(configured[3]!, 'Send');

    const invalid: Array<[unknown, typeof RangeError | typeof TypeError]> = [
      [{ transitionDelayMs: -1 }, RangeError],
      [{ transitionDelayMs: 1.5 }, RangeError],
      [{ transitionDelayMs: 30001 }, RangeError],
      [{ transitionDelayMs: NaN }, RangeError],
      [{ transitionDelayMs: '100' }, TypeError],
      [{ lateElementDelayMs: Infinity }, RangeError],
      [{ responseDelayMs: { '/x': -1 } }, RangeError],
      [{ responseDelayMs: { x: 1 } }, RangeError],
      [{ responseDelayMs: { '/a%20b': 1 } }, RangeError],
      [{ transitionDelayMs: undefined }, TypeError],
      [null, TypeError], [[], TypeError],
      [{ transitionDelayMs: 100, lateElementDelayMs: -1 }, RangeError],
      [{ labelOverrides: { nope: 'A' } }, RangeError],
      [{ labelOverrides: { submit: '' } }, RangeError],
      [{ labelOverrides: { submit: '   ' } }, RangeError],
      [{ labelOverrides: { submit: 'a'.repeat(81) } }, RangeError],
      [{ foo: 1 }, RangeError],
      [new Date(), TypeError], [new Map(), TypeError], [new (class {})(), TypeError],
    ];
    for (const [patch, error] of invalid) {
      expect(() => app.configure(patch as Partial<FixtureConfig>)).toThrow(error);
      expect(await pageSnapshot()).toEqual(configured);
      const probe = await measuredRequest(app, '/probe');
      expectDelay(probe.elapsed, 444);
      expect(await probe.response.text()).toBe('<h1>Probe</h1>');
    }
    expect(() => app.configure({})).not.toThrow();
    expect(await pageSnapshot()).toEqual(configured);
    const noOpProbe = await measuredRequest(app, '/probe');
    expectDelay(noOpProbe.elapsed, 444);
    await noOpProbe.response.text();
    app.reset();
    expect(await pageSnapshot()).toEqual(defaults);
    expect(defaults[1]).toMatch(/\b0\b/);
    expect(defaults[2]).toMatch(/\b0\b/);
    expectButton((await pageSnapshot())[3]!, 'Submit');

    const delays = { '/late': 100 };
    app.configure({ responseDelayMs: delays });
    delays['/late'] = 5000;
    const copiedDelay = await measuredRequest(app, '/late');
    expectDelay(copiedDelay.elapsed, 100);
    await copiedDelay.response.text();
    const labels = { submit: 'Send' };
    app.configure({ labelOverrides: labels });
    labels.submit = 'Mutated';
    expectButton(await (await request(app, '/label')).text(), 'Send');

    app.setPage('/probe', 'probe');
    app.configure({ responseDelayMs: { '/probe': 600 }, labelOverrides: { submit: 'Send' } });
    const oldProbe = await measuredRequest(app, '/probe');
    expectDelay(oldProbe.elapsed, 600);
    await oldProbe.response.text();
    app.configure({ responseDelayMs: { '/late': 100 }, labelOverrides: {} });
    const replacedProbe = await measuredRequest(app, '/probe');
    expect(replacedProbe.elapsed).toBeLessThanOrEqual(DELAY_UPPER_SLACK_MS);
    await replacedProbe.response.text();
    expectButton(await (await request(app, '/label')).text(), 'Submit');

    for (const patch of [
      { transitionDelayMs: 0 }, { transitionDelayMs: 30000 },
      { labelOverrides: { submit: 'a' } },
      { labelOverrides: { submit: 'a'.repeat(80) } },
    ]) expect(() => app.configure(patch)).not.toThrow();
    const repeat = {
      transitionDelayMs: 111, lateElementDelayMs: 222, readyDelayMs: 333,
      responseDelayMs: { '/probe': 100 }, labelOverrides: { submit: '  Send ' },
    };
    app.configure(repeat);
    const once = await pageSnapshot();
    const onceProbe = await measuredRequest(app, '/probe');
    expectDelay(onceProbe.elapsed, 100);
    await onceProbe.response.text();
    app.configure(repeat);
    expect(await pageSnapshot()).toEqual(once);
    const twiceProbe = await measuredRequest(app, '/probe');
    expectDelay(twiceProbe.elapsed, 100);
    await twiceProbe.response.text();
    expectButton(once[3]!, 'Send');
    expect(once[3]).not.toContain('  Send ');
  });
});

describe('fixture app response delay', () => {

  it('TEST-7 holds each response for the configured delay within tolerance', async () => {
    const app = getApp();
    expect(100 + DELAY_UPPER_SLACK_MS).toBeLessThan(600 - DELAY_LOWER_SLACK_MS);
    app.configure({ responseDelayMs: { '/late': 600, '*': 100 } });
    for (const [path, delay] of [['/late', 600], ['/ready', 100], ['/', 100]] as const) {
      const result = await measuredRequest(app, path);
      expect(result.response.status).toBe(200);
      expectDelay(result.elapsed, delay);
      await result.response.text();
    }
    app.configure({ responseDelayMs: { '*': 600 } });
    const replaced = await measuredRequest(app, '/late');
    expectDelay(replaced.elapsed, 600);
    await replaced.response.text();
    app.setPage('/zero', 'zero');
    app.configure({ responseDelayMs: { '/zero': 0 } });
    const zero = await measuredRequest(app, '/zero');
    expect(zero.response.status).toBe(200);
    expect(zero.elapsed).toBeLessThanOrEqual(DELAY_UPPER_SLACK_MS);
    await zero.response.text();
    app.configure({ responseDelayMs: { '/missing': 600, '/dashboard': 600 } });
    for (const [path, status] of [['/missing', 404], ['/dashboard', 302]] as const) {
      const result = await measuredRequest(app, path);
      expect(result.response.status).toBe(status);
      expectDelay(result.elapsed, 600);
      if (status === 302) expect(result.response.headers.get('location')).toBe('/login');
      await result.response.text();
    }
    app.setPage('/pending', 'pending');
    app.configure({ responseDelayMs: { '/pending': 600 } });
    const pending = measuredRequest(app, '/pending');
    await vi.waitFor(() => { expect(app.requestCount('/pending')).toBe(1); });
    app.configure({ responseDelayMs: {} });
    const fixed = await pending;
    expectDelay(fixed.elapsed, 600);
    expect(await fixed.response.text()).toBe('pending');
    app.configure({ responseDelayMs: { '/login': 600 } });
    const oversized = await measuredRequest(app, '/login', {
      method: 'POST', headers: { 'content-type': FORM_TYPE }, body: paddedForm(4097),
    });
    expect(oversized.response.status).toBe(413);
    expectDelay(oversized.elapsed, 600);
    expect(await oversized.response.text()).toBe('');
  });
});

describe('fixture app login session', () => {

  it('TEST-8 preserves the issued login token across separate connections', async () => {
    const app = getApp();
    app.configure({ responseDelayMs: { '/login': 200 } });
    // Closing the issuing connection makes session independence observable even with fetch pooling.
    const response = await request(app, '/login', {
      method: 'POST', headers: { 'content-type': FORM_TYPE, connection: 'close' }, body: VALID_FORM,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/dashboard');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toMatch(new RegExp('^' + SESSION_COOKIE_NAME + '=[0-9a-f-]+; Path=\\/; HttpOnly; SameSite=Lax$'));
    await response.text();
    const dashboard = await request(app, '/dashboard', { headers: { cookie: cookie! } });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toMatch(/<h1\b[^>]*>Dashboard<\/h1>/);
  });

  it('TEST-8 authenticates bounded form bodies and keeps independent UUID sessions', async () => {
    const app = getApp();
    for (const cookie of [undefined, `${SESSION_COOKIE_NAME}=garbage`]) {
      const response = await request(app, '/dashboard',
        cookie === undefined ? {} : { headers: { cookie } });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/login');
      expect(await response.text()).toBe('');
    }
    const first = await login(app);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/dashboard');
    expect(await first.text()).toBe('');
    const firstCookie = first.headers.get('set-cookie');
    expect(firstCookie).toMatch(new RegExp('^' + SESSION_COOKIE_NAME
      + '=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}; Path=\\/; HttpOnly; SameSite=Lax$'));
    const dashboard = await request(app, '/dashboard', { headers: { cookie: firstCookie! } });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.text()).toMatch(/<h1\b[^>]*>Dashboard<\/h1>/);
    for (const [body, contentType] of [
      [new URLSearchParams({ username: FIXTURE_CREDENTIALS.username, passcode: 'wrong' }).toString(), FORM_TYPE],
      [new URLSearchParams({ passcode: FIXTURE_CREDENTIALS.passcode }).toString(), FORM_TYPE],
      [new URLSearchParams({ username: FIXTURE_CREDENTIALS.username }).toString(), FORM_TYPE],
      [JSON.stringify(FIXTURE_CREDENTIALS), 'application/json'],
      [VALID_FORM, 'application/x-www-form-urlencoded-extra'],
    ] as const) {
      const response = await login(app, body, contentType);
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await response.text()).toContain('Invalid credentials');
    }
    const boundary = await login(app, paddedForm(4096));
    expect(boundary.status).toBe(302);
    expect(boundary.headers.get('location')).toBe('/dashboard');
    await boundary.text();
    const oversized = await login(app, paddedForm(4097));
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).toBe('');
    expect(oversized.headers.get('connection')).toBe('close');
    expect(oversized.headers.get('set-cookie')).toBeNull();
    const healthy = await request(app, '/', { headers: { connection: 'close' } });
    expect(healthy.status).toBe(200);
    await healthy.text();
    const second = await login(app);
    expect(second.status).toBe(302);
    const secondCookie = second.headers.get('set-cookie');
    expect(secondCookie).not.toBeNull();
    expect(secondCookie).not.toBe(firstCookie);
    await second.text();
    for (const cookie of [firstCookie!, secondCookie!]) {
      const response = await request(app, '/dashboard', { headers: { cookie } });
      expect(response.status).toBe(200);
      await response.text();
    }
    const loginPage = await request(app, '/login', { headers: { cookie: firstCookie! } });
    expect(loginPage.status).toBe(200);
    const loginHtml = await loginPage.text();
    expect(loginHtml).toContain('Account access');
    expect(loginHtml).toMatch(/<form\b/);
    const mixedCase = await login(app, VALID_FORM, 'Application/X-WWW-Form-Urlencoded; charset=utf-8');
    expect(mixedCase.status).toBe(302);
    await mixedCase.text();
    const duplicate = await login(app, `username=wrong&${VALID_FORM}`);
    expect(duplicate.status).toBe(401);
    expect(duplicate.headers.get('set-cookie')).toBeNull();
    expect(await duplicate.text()).toContain('Invalid credentials');

    const socket = await openSocket(app.port);
    const closed = collectRaw(socket);
    try {
      const before = app.requestCount('/login');
      socket.write(`POST /login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: ${FORM_TYPE}\r\nContent-Length: ${Buffer.byteLength(VALID_FORM) + 20}\r\nConnection: close\r\n\r\n${VALID_FORM}`);
      await vi.waitFor(() => { expect(app.requestCount('/login')).toBe(before + 1); });
      socket.destroy();
      await closed;
      const afterDisconnect = await request(app, '/', { headers: { connection: 'close' } });
      expect(afterDisconnect.status).toBe(200);
      await afterDisconnect.text();
    } finally {
      socket.destroy();
      await closed;
    }
  });
});

describe('fixture app reset and request count', () => {

  it('TEST-9 preserves receipt-time login routing when setPage changes during body reading', async () => {
    const app = getApp();
    const socket = await openSocket(app.port);
    const raw = collectRaw(socket);
    try {
      const split = Math.floor(VALID_FORM.length / 2);
      socket.write(`POST /login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: ${FORM_TYPE}\r\nContent-Length: ${Buffer.byteLength(VALID_FORM)}\r\nConnection: close\r\n\r\n${VALID_FORM.slice(0, split)}`);
      await vi.waitFor(() => { expect(app.requestCount('/login')).toBe(1); });
      expect(app.inflight()).toBe(0);
      app.setPage('/login', '<h1>Replaced</h1>');
      socket.write(VALID_FORM.slice(split));
      const completed = rawResponse(await raw);
      expect(completed.status).toBe(302);
      expect(completed.headers.get('location')).toBe('/dashboard');
      const cookie = completed.headers.get('set-cookie');
      expect(cookie).toMatch(new RegExp('^' + SESSION_COOKIE_NAME + '=[0-9a-f-]+; Path=\\/; HttpOnly; SameSite=Lax$'));
      const dashboard = await request(app, '/dashboard', { headers: { cookie: cookie! } });
      expect(dashboard.status).toBe(200);
      expect(await dashboard.text()).toMatch(/<h1\b[^>]*>Dashboard<\/h1>/);
      const fresh = await login(app);
      expect(fresh.status).toBe(405);
      expect(fresh.headers.get('allow')).toBe('GET, HEAD');
      expect(fresh.headers.get('set-cookie')).toBeNull();
      await fresh.text();
    } finally {
      socket.destroy();
      await raw;
    }
  });

  it('TEST-9 reads the live login delay when a pending body completes', async () => {
    const app = getApp();
    const socket = await openSocket(app.port);
    const chunks: Buffer[] = [];
    let socketError: Error | undefined;
    let timedOut = false;
    // This response intentionally outlasts collectRaw's two-second deadline.
    const deadline = setTimeout(() => {
      timedOut = true;
      socket.destroy();
    }, 6500);
    const raw = new Promise<string>((resolve) => {
      socket.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      socket.once('error', (error: Error) => { socketError = error; });
      socket.once('close', () => {
        clearTimeout(deadline);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    try {
      const split = Math.floor(VALID_FORM.length / 2);
      socket.write(`POST /login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: ${FORM_TYPE}\r\nContent-Length: ${Buffer.byteLength(VALID_FORM)}\r\nConnection: close\r\n\r\n${VALID_FORM.slice(0, split)}`);
      await vi.waitFor(() => { expect(app.requestCount('/login')).toBe(1); });
      expect(app.inflight()).toBe(0);
      app.configure({ responseDelayMs: { '/login': 5000 } });
      const start = performance.now();
      socket.write(VALID_FORM.slice(split));
      const bytes = await raw;
      const elapsed = performance.now() - start;
      expect(timedOut).toBe(false);
      expect(socketError).toBeUndefined();
      const completed = rawResponse(bytes);
      expect(completed.status).toBe(302);
      expect(completed.headers.get('location')).toBe('/dashboard');
      expect(completed.headers.get('set-cookie')).toMatch(
        new RegExp('^' + SESSION_COOKIE_NAME + '=[0-9a-f-]+; Path=\\/; HttpOnly; SameSite=Lax$'),
      );
      expectDelay(elapsed, 5000);
    } finally {
      clearTimeout(deadline);
      socket.destroy();
      await raw;
    }
  }, 8000);

  it('TEST-9 preserves an authenticated dashboard fixed before reset invalidates its cookie', async () => {
    const app = getApp();
    const authenticated = await login(app);
    expect(authenticated.status).toBe(302);
    const cookie = authenticated.headers.get('set-cookie');
    expect(cookie).not.toBeNull();
    await authenticated.text();
    app.configure({ responseDelayMs: { '/dashboard': 300 } });
    const pending = request(app, '/dashboard', { headers: { cookie: cookie! } });
    await vi.waitFor(() => { expect(app.requestCount('/dashboard')).toBe(1); });
    app.reset();
    const preserved = await pending;
    expect(preserved.status).toBe(200);
    expect(await preserved.text()).toMatch(/<h1\b[^>]*>Dashboard<\/h1>/);
    const fresh = await request(app, '/dashboard', { headers: { cookie: cookie! } });
    expect(fresh.status).toBe(302);
    expect(fresh.headers.get('location')).toBe('/login');
    await fresh.text();
  });

  it('TEST-9 resets state while preserving fixed responses and body-completion semantics', async () => {
    const app = getApp();
    const authenticated = await login(app);
    expect(authenticated.status).toBe(302);
    const oldCookie = authenticated.headers.get('set-cookie');
    expect(oldCookie).not.toBeNull();
    await authenticated.text();
    app.setPage('/x', '<h1>Custom</h1>');
    app.configure({ responseDelayMs: { '*': 400 }, labelOverrides: { submit: 'Send' }, transitionDelayMs: 100 });
    for (const path of ['/', '/x', '/label']) await (await request(app, path)).text();
    expect(app.requestCount('/')).toBeGreaterThan(0);
    const { baseUrl, port } = app;
    for (let reset = 0; reset < 2; reset += 1) {
      app.reset();
      expect(app.requestCount('/')).toBe(0);
      expect(app.inflight()).toBe(0);
      expect(app.baseUrl).toBe(baseUrl);
      expect(app.port).toBe(port);
      const dashboard = await request(app, '/dashboard', { headers: { cookie: oldCookie! } });
      expect(dashboard.status).toBe(302);
      expect(dashboard.headers.get('location')).toBe('/login');
      await dashboard.text();
      const custom = await request(app, '/x');
      expect(custom.status).toBe(404);
      await custom.text();
      const label = await (await request(app, '/label')).text();
      expectButton(label, 'Submit');
      expect(label).not.toContain('Send');
      const immediate = await measuredRequest(app, '/ready');
      expect(immediate.response.status).toBe(200);
      expect(immediate.elapsed).toBeLessThanOrEqual(DELAY_UPPER_SLACK_MS);
      await immediate.response.text();
      expect(app.requestCount('/')).toBe(0);
      expect(app.inflight()).toBe(0);
    }

    app.setPage('/pending-reset', '<h1>Original</h1>');
    app.configure({ responseDelayMs: { '/pending-reset': 600 } });
    const pending = measuredRequest(app, '/pending-reset');
    await vi.waitFor(() => { expect(app.requestCount('/pending-reset')).toBe(1); });
    app.reset();
    const preserved = await pending;
    expect(preserved.response.status).toBe(200);
    expect(await preserved.response.text()).toBe('<h1>Original</h1>');
    expectDelay(preserved.elapsed, 600);

    app.configure({ responseDelayMs: { '/login': 600 } });
    const pendingLogin = login(app);
    await vi.waitFor(() => { expect(app.inflight()).toBe(1); });
    app.reset();
    const fixedLogin = await pendingLogin;
    expect(fixedLogin.status).toBe(302);
    expect(fixedLogin.headers.get('location')).toBe('/dashboard');
    const invalidatedCookie = fixedLogin.headers.get('set-cookie');
    expect(invalidatedCookie).not.toBeNull();
    await fixedLogin.text();
    const invalidated = await request(app, '/dashboard', { headers: { cookie: invalidatedCookie! } });
    expect(invalidated.status).toBe(302);
    expect(invalidated.headers.get('location')).toBe('/login');
    await invalidated.text();

    app.reset();
    const socket = await openSocket(app.port);
    const raw = collectRaw(socket);
    try {
      const split = Math.floor(VALID_FORM.length / 2);
      socket.write(`POST /login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: ${FORM_TYPE}\r\nContent-Length: ${Buffer.byteLength(VALID_FORM)}\r\nConnection: close\r\n\r\n${VALID_FORM.slice(0, split)}`);
      await vi.waitFor(() => { expect(app.requestCount('/login')).toBe(1); });
      expect(app.inflight()).toBe(0);
      app.reset();
      socket.write(VALID_FORM.slice(split));
      const completed = rawResponse(await raw);
      expect(completed.status).toBe(302);
      expect(completed.headers.get('location')).toBe('/dashboard');
      const freshCookie = completed.headers.get('set-cookie');
      expect(freshCookie).not.toBeNull();
      const freshDashboard = await request(app, '/dashboard', { headers: { cookie: freshCookie! } });
      expect(freshDashboard.status).toBe(200);
      await freshDashboard.text();
    } finally {
      socket.destroy();
      await raw;
    }

    app.reset();
    app.configure({ responseDelayMs: { '/late': 600 } });
    const first = request(app, '/late');
    const second = request(app, '/late');
    await vi.waitFor(() => {
      expect(app.requestCount('/late')).toBe(2);
      expect(app.inflight()).toBe(2);
    });
    const responses = await Promise.all([first, second]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      await response.text();
    }
    await vi.waitFor(() => { expect(app.inflight()).toBe(0); });
  });

  it('TEST-10 counts received paths and allows state-only operations after stop', async () => {
    const app = getApp();
    for (const [path, method] of [
      ['/late', 'GET'], ['/late', 'GET'], ['/late', 'HEAD'],
      ['/late?x=1', 'GET'], ['/nope', 'GET'], ['/', 'POST'],
    ] as const) await (await request(app, path, { method })).arrayBuffer();
    expect(app.requestCount('/late')).toBe(4);
    expect(app.requestCount('/nope')).toBe(1);
    expect(app.requestCount('/')).toBe(1);
    expect(app.requestCount('/ready')).toBe(0);
    expect(() => app.requestCount('late')).toThrow(RangeError);
    await app.stop();
    expect(() => app.requestCount('/late')).not.toThrow();
    expect(() => app.configure({ transitionDelayMs: 100 })).not.toThrow();
    expect(() => app.reset()).not.toThrow();
    expect(() => app.setPage('/after-stop', 'state only')).not.toThrow();
    await expectClosed(app.port);
  });
});

describe('heal-cli migration leaves no residual inline server', () => {
  it('TEST-19 contains no inline createServer/listen/closeServer construction', async () => {
    const source = await readFile(
      new URL('./heal-cli.contract.test.ts', import.meta.url),
      'utf8',
    );
    // Built via concatenation so this check string can never accidentally match itself.
    const residualMarkers = [
      'create' + 'Server',
      'server.' + 'listen',
      'close' + 'Server',
    ];
    for (const marker of residualMarkers) {
      expect(source).not.toContain(marker);
    }
  });
});
