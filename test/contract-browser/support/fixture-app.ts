import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { CleanupRegistry } from './cleanup-registry.js';

/**
 * Credentials accepted by the fixture's built-in login flow.
 * @remarks A single fixed login contract keeps session tests comparable across pages;
 * credentials are not another configurable dimension of the fixture.
 */
export const FIXTURE_CREDENTIALS = { username: 'fixture-user', passcode: 'fixture-pass' } as const;
/**
 * Identifies the one fixed cookie carrying the built-in session token.
 * Tests and page code rely on this constant name; it is not configurable.
 */
export const SESSION_COOKIE_NAME = 'fixture_session';
/**
 * Upper bound for every configurable server and browser delay.
 * @remarks The shared bound keeps intentional waiting within the suite's default
 * timeout budget rather than allowing each page to introduce unbounded waiting.
 */
export const MAX_DELAY_MS = 30_000;
/**
 * Lower timing allowance for measured delays, accounting for timer rounding.
 * @remarks Use with the upper allowance so all contract tests share one tolerance.
 */
export const DELAY_LOWER_SLACK_MS = 5;
/**
 * Upper timing allowance accounting for CI scheduling jitter.
 * Tests use both slack constants: measured elapsed time must fall within
 * [configuredDelay - DELAY_LOWER_SLACK_MS, configuredDelay + DELAY_UPPER_SLACK_MS].
 */
export const DELAY_UPPER_SLACK_MS = 250;
/**
 * Built-in accessible names that configuration may override.
 * @remarks Keeping the supported names in one table prevents page generation and
 * validation from independently defining which labels are configurable.
 */
export const LABEL_DEFAULTS = { submit: 'Submit' } as const;

/** Supported override keys, derived from the actual default table to prevent drift. */
export type LabelKey = keyof typeof LABEL_DEFAULTS;

/**
 * Immutable configuration consumed by the fixture's server and generated pages.
 * @remarks Configuration uses field replacement rather than deep merging. After
 * configure(), the server reads its own validated, frozen copies, so retaining and
 * mutating a caller-owned map cannot change later requests.
 */
export interface FixtureConfig {
  /** Route-keyed response delays, independent of client-side rendering delays. */
  readonly responseDelayMs: Readonly<Record<string, number>>;
  /** Delay between a client-side transition starting and its resulting view. */
  readonly transitionDelayMs: number;
  /** Delay before the late-rendering page inserts its observable element. */
  readonly lateElementDelayMs: number;
  /** Delay before the readiness page enables its observable action. */
  readonly readyDelayMs: number;
  /** Accessible-name replacements for keys supported by LABEL_DEFAULTS. */
  readonly labelOverrides: Readonly<Partial<Record<LabelKey, string>>>;
}

/**
 * A controllable HTTP application for contract tests using HTTP or a real browser.
 * @remarks Named pages, delays, sessions, and reset share one lifecycle instead of
 * requiring each test to own server boilerplate. Configuration, pages, and sessions
 * deliberately have no read-back API: tests observe their effects as app users do.
 * Non-login responses fix their behavior at receipt; POST /login fixes it when its
 * body completes. Reset before a delayed login send invalidates that login's token.
 */
export interface FixtureApp {
  /** Loopback origin for this instance, suitable for browser navigation. */
  readonly baseUrl: string;
  /** Ephemeral listening port, allowing independent instances to coexist. */
  readonly port: number;
  /**
   * Builds a navigation URL without imposing registration-key restrictions.
   * @param path - Caller-selected navigation path, including any query string.
   * @returns A URL at this fixture's origin.
   * @throws If the path contains a fragment marker or whitespace.
   */
  url(path: string): string;
  /**
   * Replaces supplied configuration fields after validating the complete patch.
   * @param patch - Fields to replace; nested maps are not deep-merged.
   * @throws If a supplied key or value violates the configuration contract;
   * the existing configuration remains unchanged.
   * @remarks Validation applies to the full prospective configuration, so failure
   * never leaves partially applied state. Accepted values are copied and
   * frozen to isolate server behavior from subsequent caller mutations.
   */
  configure(patch: Partial<FixtureConfig>): void;
  /**
   * Registers HTML under an unambiguous routing key.
   * @param path - Route key without dot, parent, or empty path segments.
   * @param html - Page content, including empty strings or Unicode content.
   * @throws If the route key is invalid.
   * @remarks Registrations can replace built-in route pages as well as add pages.
   * The most recent call for a path wins; reset clears all registrations and
   * restores the built-in set.
   */
  setPage(path: string, html: string): void;
  /**
   * Observes received requests without exposing private routing or session state.
   * @param path - Path whose request count is needed for synchronization or assertions.
   * @returns The recorded request count for that path.
   */
  requestCount(path: string): number;
  /**
   * Observes accepted requests still awaiting completion.
   * @returns The current in-flight count, allowing tests to synchronize delayed work.
   */
  inflight(): number;
  /**
   * Restores per-test state so a shared instance can serve independent test cases.
   * @remarks Configuration returns to defaults, setPage registrations are cleared
   * so built-in routes return, all session tokens are invalidated, and per-path
   * request counts return to zero. The server address (baseUrl and port) and
   * currently-running delay timers are preserved. Already-fixed responses complete
   * using their pre-reset configuration and page content, except a pending login's
   * token is invalidated if reset precedes its delayed send.
   */
  reset(): void;
  /**
   * Ends the instance's lifecycle and discards pending delayed responses.
   * @returns The same cached shutdown promise on repeated calls.
   * @throws The promise rejects if server closure fails; that rejection is cached.
   * @remarks Timer cancellation and connection teardown are best-effort even when
   * closure fails. Pending clients observe dropped connections, not late responses;
   * repeated calls do not attempt recovery from a failed shutdown.
   * Every still-pending delay timer is cancelled and its already-fixed response
   * discarded; requests completed before stop are untouched. A built-in POST
   * /login whose body is still being read is withdrawn: destroy its socket, issue
   * no token, and create no delay timer, without an unhandled rejection. A token
   * already committed at body completion remains valid if the client subsequently
   * disconnects before its redirect is sent.
   */
  stop(): Promise<void>;
}

/**
 * Optional registry integration supports different teardown ownership scopes.
 * Callers sharing an instance across tests through beforeAll/afterAll manage their
 * own teardown without a per-operation CleanupRegistry; per-test instances
 * typically opt into registry-driven teardown instead of hand-rolling it.
 */
export interface StartFixtureAppOptions {
  /**
   * Optional owner of teardown through the existing CleanupRegistry contract.
   * Omit when shared beforeAll/afterAll hooks explicitly own the instance.
   */
  readonly registry?: CleanupRegistry;
}

/**
 * Starts an isolated fixture application on an ephemeral IPv4 loopback port.
 * @param _options - Optional cleanup-registry integration.
 * @returns A running instance driven through configuration and HTTP observations.
 * @throws The promise rejects if the server cannot start.
 * @remarks Registry registration uses the existing deferResource lifecycle so
 * callers can replace an inline server without introducing another cleanup model.
 * Each instance owns its routing, session, timer, and request-count state.
 * The HTTP handler is a closure over config, pages, sessions, counts, timers,
 * inflightCount, and stopped. A request-target starting with //, or for which
 * new URL(req.url, 'http://127.0.0.1') throws, receives an immediate 400 without
 * counting, delay, or routing. Every other path's count increments at receipt,
 * before any body is read.
 * For POST /login without a custom /login page, response fixation, session check,
 * and token issuance happen atomically when its body finishes reading. Disconnect,
 * stream error, or stop during body reading withdraws the request: destroy its
 * socket, issue no token, and create no delay timer; no unhandled rejection escapes.
 * Every other request fixes response, status, and content at receipt. A custom
 * /login override is gated to GET/HEAD before any login logic runs and follows
 * this receipt-time contract.
 * Fixed responses wait their configured delay before sending: non-login paths use
 * responseDelayMs[path] ?? responseDelayMs['*'] ?? 0; the login path's own delay
 * runs from its fixation point. inflight counts exactly fixed-but-unsent responses,
 * incrementing once per fixation and decrementing exactly once at actual send,
 * including a possibly already-elapsed zero delay. A token committed at body
 * completion remains valid after a later client disconnect before redirect send.
 * stop cancels pending timers and discards fixed responses, dropping connected
 * clients rather than sending late; already-completed requests are untouched.
 */
export async function startFixtureApp(_options?: StartFixtureAppOptions): Promise<FixtureApp> {
  if (_options === null || (_options?.registry != null && typeof _options.registry.deferResource !== 'function')) {
    throw new TypeError('startFixtureApp options must be undefined, or an object whose registry (if present) implements deferResource.');
  }
  const defaults = (): FixtureConfig => ({ responseDelayMs: {}, transitionDelayMs: 0, lateElementDelayMs: 0, readyDelayMs: 0, labelOverrides: {} });
  let config = defaults();
  const pages = new Map<string, string>();
  const sessions = new Set<string>();
  const counts = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let inflightCount = 0;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  const headers = (extra: Record<string, string> = {}) => ({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra });

  function readBody(req: IncomingMessage, limit: number): Promise<{ tooLarge: true } | { tooLarge: false; body: string }> {
    return new Promise((resolve, reject) => {
      let bytes = 0;
      const chunks: Buffer[] = [];
      let tooLarge = false;
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error('request body read failed'));
      };
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limit) { tooLarge = true; return; }
        chunks.push(chunk);
      });
      req.once('end', () => {
        if (settled) return;
        settled = true;
        resolve(tooLarge ? { tooLarge: true } : { tooLarge: false, body: Buffer.concat(chunks).toString('utf8') });
      });
      req.once('aborted', fail);
      req.once('error', fail);
      req.once('close', () => { if (!settled) fail(new Error('connection closed before body completed')); });
    });
  }

  function send(delay: number, fn: () => void): void {
    const guarded = () => { if (!stopped) fn(); };
    if (delay === 0) { guarded(); return; }
    const timer = setTimeout(() => { timers.delete(timer); guarded(); }, delay);
    timers.add(timer);
  }

  function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
    for (const part of cookieHeader?.split(';') ?? []) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE_NAME) return rest.join('=');
    }
    return undefined;
  }

  function route(method: string | undefined, path: string, cookie: string | undefined, snapshot: FixtureConfig) {
    if (pages.has(path)) {
      return method === 'GET' || method === 'HEAD'
        ? { status: 200, headers: headers(), body: pages.get(path)! }
        : { status: 405, headers: headers({ allow: 'GET, HEAD' }), body: '' };
    }
    const known = ['/', '/spa', '/spa/items/1', '/spa/items/2', '/late', '/ready', '/label', '/login', '/dashboard'].includes(path);
    if (known && method !== 'GET' && method !== 'HEAD') {
      return { status: 405, headers: headers({ allow: path === '/login' ? 'GET, HEAD, POST' : 'GET, HEAD' }), body: '' };
    }
    switch (path) {
      case '/': return { status: 200, headers: headers(), body: indexPage(snapshot) };
      case '/spa': return { status: 200, headers: headers(), body: spaShell(snapshot, 'list') };
      case '/spa/items/1':
      case '/spa/items/2': return { status: 200, headers: headers(), body: spaShell(snapshot, path.endsWith('/1') ? '1' : '2') };
      case '/late': return { status: 200, headers: headers(), body: latePage(snapshot) };
      case '/ready': return { status: 200, headers: headers(), body: readyPage(snapshot) };
      case '/label': return { status: 200, headers: headers(), body: labelPage(snapshot) };
      case '/login': return { status: 200, headers: headers(), body: loginPage() };
      case '/dashboard': {
        const token = parseSessionCookie(cookie);
        return token !== undefined && sessions.has(token)
          ? { status: 200, headers: headers(), body: dashboardPage() }
          : { status: 302, headers: headers({ location: '/login' }), body: '' };
      }
      default: return { status: 404, headers: headers(), body: notFoundPage() };
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    let url: URL;
    try {
      if (req.url === undefined || req.url.startsWith('//')) throw new Error('Invalid request target');
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400, headers({ 'content-length': '0' }));
      res.end('');
      return;
    }
    const path = url.pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const finish = (status: number, replyHeaders: Record<string, string>, body: string, delay: number) => {
      inflightCount += 1;
      send(delay, () => {
        inflightCount -= 1;
        res.writeHead(status, replyHeaders);
        res.end(body);
      });
    };
    if (req.method === 'POST' && path === '/login' && !pages.has(path)) {
      void readBody(req, 4096).then((result) => {
        if (stopped) { res.destroy(); return; }
        const snapshot = config;
        const delay = snapshot.responseDelayMs[path] ?? snapshot.responseDelayMs['*'] ?? 0;
        if (result.tooLarge) { finish(413, headers({ connection: 'close' }), '', delay); return; }
        const mediaType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
        const params = mediaType === 'application/x-www-form-urlencoded' ? new URLSearchParams(result.body) : new URLSearchParams();
        if (mediaType === 'application/x-www-form-urlencoded' && params.get('username') === FIXTURE_CREDENTIALS.username && params.get('passcode') === FIXTURE_CREDENTIALS.passcode) {
          const token = randomUUID();
          sessions.add(token);
          finish(302, headers({ location: '/dashboard', 'set-cookie': `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax` }), '', delay);
        } else {
          finish(401, headers(), loginPage('Invalid credentials'), delay);
        }
      }).catch(() => { res.destroy(); });
      return;
    }
    req.once('error', () => { res.destroy(); });
    req.resume();
    const snapshot = config;
    const reply = route(req.method, path, req.headers.cookie, snapshot);
    finish(reply.status, reply.headers, reply.body, snapshot.responseDelayMs[path] ?? snapshot.responseDelayMs['*'] ?? 0);
  }

  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port: 0 }, () => { server.off('error', onError); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('The fixture app did not expose a TCP address.');
  }
  const app: FixtureApp = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    url(path) { assertUrlPath(path); return app.baseUrl + path; },
    configure(patch) {
      if (patch === null || typeof patch !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(patch))) throw new TypeError('Configuration patch must be a plain object.');
      config = validatePatch({ ...config, ...patch });
    },
    setPage(path, html) { assertPath(path); if (typeof html !== 'string') throw new TypeError('setPage html must be a string.'); pages.set(path, html); },
    requestCount(path) { assertPath(path); return counts.get(path) ?? 0; },
    inflight() { return inflightCount; },
    reset() { config = defaults(); pages.clear(); sessions.clear(); counts.clear(); },
    stop() {
      stopPromise ??= (async () => {
        stopped = true;
        inflightCount = 0;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        try { server.closeAllConnections(); }
        finally {
          if (server.listening) await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
        }
      })();
      return stopPromise;
    },
  };
  if (_options?.registry) {
    try { _options.registry.deferResource(() => app.stop()); }
    catch (err) {
      try { await app.stop(); }
      catch (stopError) { if (err instanceof Error) Object.defineProperty(err, 'cause', { value: stopError, configurable: true, writable: true }); }
      throw err;
    }
  }
  return app;
}

// Registration and response-delay keys must identify one unambiguous route. Reject
// dot, parent, and empty segments rather than applying browser path normalization;
// this narrow throwing guard is shared only by entry points with routing-key semantics.
// Throws TypeError for a non-string. Throws RangeError unless the path matches
// /^\/[A-Za-z0-9._~\/-]*$/, is at most 200 characters, and, except for exactly /,
// has no empty, . or .. segment. Thus trailing slashes, //, /a/./b and /a/../b are rejected; only /
// itself may end in /.
function assertPath(_path: unknown): asserts _path is string {
  if (typeof _path !== 'string') throw new TypeError('Route path must be a string.');
  if (!/^\/[A-Za-z0-9._~\/-]*$/.test(_path) || _path.length > 200 || (_path !== '/' && _path.slice(1).split('/').some((part) => part === '' || part === '.' || part === '..'))) throw new RangeError('Invalid route path.');
}

// Navigation echoes the caller's chosen path, including queries, instead of treating
// it as a registration key. Its separate guard forbids fragments and whitespace
// without importing the stricter segment restrictions of assertPath.
// Used only by url(), never routing or registration. Throws TypeError for a
// non-string; throws RangeError if it does not start with / or contains # or any
// whitespace character. Dot/parent segments and arbitrary lengths are allowed:
// navigation usability needs fewer restrictions than an unambiguous routing key.
function assertUrlPath(_path: unknown): asserts _path is string {
  if (typeof _path !== 'string') throw new TypeError('Navigation path must be a string.');
  if (!_path.startsWith('/') || /[#\s]/.test(_path)) throw new RangeError('Invalid navigation path.');
}

// A common bounded-delay guard keeps response and page timers within the same suite
// timeout budget. The field name identifies the offending configuration value when
// the guard throws, without coupling it to any particular page generator.
// Throws TypeError for a non-number. Throws RangeError for a non-integer,
// negative value, or value exceeding MAX_DELAY_MS, including NaN and Infinity.
function assertDelay(_name: string, _v: unknown): void {
  if (typeof _v !== 'number') throw new TypeError(`${_name} must be a number.`);
  if (!Number.isInteger(_v) || _v < 0 || _v > MAX_DELAY_MS) throw new RangeError(`${_name} must be an integer from 0 to ${MAX_DELAY_MS}.`);
}

// The parameter named patch is configure's full merged five-field object, not the
// caller's original partial fragment; this guard takes and returns the complete
// FixtureConfig shape rather than a Partial.
// Throws TypeError unless the outer object has Object.prototype or null as its
// prototype (excluding arrays, Date, Map and class instances), or if any own
// enumerable value is undefined. Throws RangeError for any own enumerable key
// outside the five FixtureConfig field names. Scalar delays pass assertDelay.
// Each own enumerable responseDelayMs key must be * or pass assertPath, and each
// value must pass assertDelay. Each own enumerable labelOverrides key must exist
// in LABEL_DEFAULTS; its value must be a string (otherwise TypeError) whose trimmed
// length is 1 through 80 inclusive (otherwise RangeError).
// The same Object.keys-based walk applies to both nested objects, without a
// separate Object.getPrototypeOf check unlike the outer patch. An object with no
// own enumerable string keys, such as a Map, validates as an empty, no-op map.
function validatePatch(_patch: unknown): FixtureConfig {
  if (_patch === null || typeof _patch !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(_patch))) throw new TypeError('Configuration patch must be a plain object.');
  const patch = _patch as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) throw new TypeError(`${key} must not be undefined.`);
    switch (key) {
      case 'transitionDelayMs': case 'lateElementDelayMs': case 'readyDelayMs': assertDelay(key, value); break;
      case 'responseDelayMs': case 'labelOverrides': {
        if (value === null || typeof value !== 'object') throw new TypeError(`${key} must be an object.`);
        for (const name of Object.keys(value)) {
          const entry = (value as Record<string, unknown>)[name];
          if (key === 'responseDelayMs') {
            if (name !== '*') assertPath(name);
            assertDelay(name, entry);
          } else {
            if (!Object.hasOwn(LABEL_DEFAULTS, name)) throw new RangeError('Unknown label key.');
            if (typeof entry !== 'string') throw new TypeError('Label must be a string.');
            if (entry.trim().length < 1 || entry.trim().length > 80) throw new RangeError('Label length must be from 1 to 80.');
          }
        }
        break;
      }
      default: throw new RangeError(`Unknown configuration key: ${key}`);
    }
  }
  const full = patch as unknown as FixtureConfig;
  return {
    responseDelayMs: Object.freeze({ ...full.responseDelayMs }),
    labelOverrides: Object.freeze(Object.fromEntries(Object.entries(full.labelOverrides).map(([key, value]) => [key, value.trim()]))),
    transitionDelayMs: full.transitionDelayMs,
    lateElementDelayMs: full.lateElementDelayMs,
    readyDelayMs: full.readyDelayMs,
  };
}

// Labels are caller-controlled free text embedded as button text beside markup.
// Escape HTML metacharacters so a label containing script-shaped text remains an
// accessible name, rather than executable markup in the real Playwright browser.
function escapeHtml(_s: string): string {
  return _s.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

const PAGE_PRELUDE = "<script>window.__fixtureEvents=[];window.__mark=function(n){window.__fixtureEvents.push({name:n,atMs:performance.now()})};window.__mark('script-start');</script>";

function documentPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${PAGE_PRELUDE}${body}</body></html>`;
}

// Every page generator below returns one complete HTML document. Each body's first
// content is a shared inline <script> prelude initializing window.__fixtureEvents
// as a timeline array and a mark(name) helper for interaction/rendering events.
// Each page records its own event names (e.g. late-inserted, ready-enabled, transition-start:<id>, detail-rendered:<id>) as documented on its own generator function below.
// Produce the entry page for the fixture's named-page behaviors without shared
// page chrome coupling otherwise independent browser contracts.
function indexPage(_config: FixtureConfig): string {
  return documentPage('Fixture index', '<h1>Fixture index</h1><nav><a href="/spa">SPA</a><a href="/late">Late element</a><a href="/ready">Ready gate</a><a href="/label">Label page</a><a href="/login">Login</a></nav>');
}

// Keep client-side transitions within a self-contained document so tests exercise
// browser state changes rather than server navigation. The initial view seeds that
// document, and configured transition timing plus transition-start:<id> timeline
// events give browser assertions an observable synchronization point.
// Uses the shared document/prelude contract documented at indexPage.
function spaShell(_config: FixtureConfig, _initialView: unknown): string {
  return documentPage(_initialView === 'list' ? 'Items' : _initialView === '1' ? 'Item 1 detail' : 'Item 2 detail', `<main id="root" aria-label="Items app" data-transition-delay-ms="${_config.transitionDelayMs}"></main>
<script>
(function(){
  var TRANSITION_DELAY = ${_config.transitionDelayMs};
  var root = document.getElementById('root');
  var showTimer = null;

  function renderList(){
    root.removeAttribute('aria-busy');
    root.innerHTML = '<h1>Items</h1><ul>'
      + '<li><a href="/spa/items/1" data-spa>Open item 1</a></li>'
      + '<li><a href="/spa/items/2" data-spa>Open item 2</a></li>'
      + '</ul>';
  }

  function showDetail(id){
    root.innerHTML = '<h1>Item ' + id + ' detail</h1>'
      + '<button type="button">Archive item ' + id + '</button>'
      + '<a href="/spa" data-spa>Back to list</a>';
    root.removeAttribute('aria-busy');
    window.__mark('detail-rendered:' + id);
  }

  function renderDetail(id){
    if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '';
    if (TRANSITION_DELAY === 0) {
      showDetail(id);
    } else {
      showTimer = setTimeout(function(){ showTimer = null; showDetail(id); }, TRANSITION_DELAY);
    }
  }

  function render(){
    var path = location.pathname;
    var match = /^\\/spa\\/items\\/(1|2)$/.exec(path);
    if (match) {
      renderDetail(match[1]);
    } else {
      if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }
      renderList();
    }
  }

  document.addEventListener('click', function(event){
    var anchor = event.target.closest('a[data-spa]');
    if (!anchor) return;
    event.preventDefault();
    var href = anchor.getAttribute('href');
    history.pushState({}, '', href);
    var itemMatch = /^\\/spa\\/items\\/(1|2)$/.exec(href);
    if (itemMatch) { window.__mark('transition-start:' + itemMatch[1]); }
    render();
  });

  window.addEventListener('popstate', render);

  render();
})();
</script>`);
}

// Delayed insertion reproduces elements that do not exist at initial load. Use the
// configured browser-side delay and record late-inserted in window.__fixtureEvents
// so tests can distinguish insertion from navigation. Uses indexPage's shared
// document/prelude contract.
function latePage(_config: FixtureConfig): string {
  return documentPage('Late element page', `<main data-late-element-delay-ms="${_config.lateElementDelayMs}"><h1>Late element page</h1><div id="slot"></div><p id="result"></p></main>
<script>
(function(){
  var DELAY = ${_config.lateElementDelayMs};
  function insert(){
    var slot = document.getElementById('slot');
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Late action';
    button.addEventListener('click', function(){
      document.getElementById('result').textContent = 'Late action done';
    });
    slot.appendChild(button);
    window.__mark('late-inserted');
  }
  if (DELAY === 0) { insert(); } else { setTimeout(insert, DELAY); }
})();
</script>`);
}

// Separate element presence from action readiness to exercise browser waiting for
// an enabled control. The configured delay ends with a ready-enabled timeline event
// in the self-contained page, rather than relying on HTTP response timing.
// Uses the shared document/prelude contract documented at indexPage.
function readyPage(_config: FixtureConfig): string {
  return documentPage('Ready gate page', `<main data-ready-delay-ms="${_config.readyDelayMs}"><h1>Ready gate page</h1><button type="button" id="gate"${_config.readyDelayMs > 0 ? ' disabled' : ''}>Continue</button><p id="result"></p></main>
<script>
(function(){
  var DELAY = ${_config.readyDelayMs};
  var gate = document.getElementById('gate');
  gate.addEventListener('click', function(){
    window.__mark('click-received');
    document.getElementById('result').textContent = 'Continued';
  });
  if (DELAY > 0) {
    setTimeout(function(){
      gate.removeAttribute('disabled');
      window.__mark('ready-enabled');
    }, DELAY);
  }
})();
</script>`);
}

// Accessible-name overrides let browser contracts exercise changed locator meaning
// without changing the action itself. Resolve against the supported default table
// and escape replacement text before embedding it. Uses indexPage's shared
// document/prelude contract without introducing shared page chrome.
function labelPage(_config: FixtureConfig): string {
  return documentPage('Label page', `<main><h1>Label page</h1><button type="button" id="action">${escapeHtml(_config.labelOverrides.submit ?? LABEL_DEFAULTS.submit)}</button><p id="result"></p></main>
<script>
document.getElementById('action').addEventListener('click', function(){
  document.getElementById('result').textContent = 'Submitted';
});
</script>`);
}

// Keep the fixed credential flow browser-visible, including an optional failure
// message, rather than exposing session internals for assertions. Session decisions
// belong to the HTTP handler, not page generation. Uses the shared document/prelude
// contract documented at indexPage.
function loginPage(_errorText?: string): string {
  return documentPage('Account access', `<main><h1>Account access</h1>${_errorText ? `<p role="alert">${escapeHtml(_errorText)}</p>` : ''}<form method="post" action="/login"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="off"><label for="passcode">Passcode</label><input id="passcode" name="passcode" type="text" autocomplete="off"><button type="submit">Sign in</button></form></main>`);
}

// Produce the authenticated destination using indexPage's document/prelude contract.
// Access control stays in HTTP routing so observing this page through a browser
// proves the cookie-session flow rather than a generator-side session shortcut.
function dashboardPage(): string {
  return documentPage('Dashboard', '<main><h1>Dashboard</h1><p>Signed in</p></main>');
}

// Use indexPage's document/prelude contract for the missing-route page,
// keeping unknown-route behavior observable through HTTP and browser navigation
// without adding an introspection API or coupling it to another page's chrome.
function notFoundPage(): string {
  return documentPage('Not found', '<main><h1>Not found</h1></main>');
}
