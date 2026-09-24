import http from 'node:http';
import net from 'node:net';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLocalReportServer } from '../../src/adapters/http/local-report-server.js';
import { createFsStorage } from '../../src/adapters/storage/fs-storage.js';
import { REPORT_SCHEMA_VERSION, ReportEnvelope } from '../../src/report/schema.js';
import { getRunReport, getRunReportBytes, getRunScreenshot, listRunReports } from '../../src/usecases/get-run-report.js';
import type { ViewPlan } from '../../src/runtime/view-command.js';
import { VIEW_COPY } from '../../src/core/viewer/copy.js';

const readableId = '20260923T064012Z-readable';
const noReportId = '20260923T064011Z-empty';
const unreadableId = '20260923T064010Z-broken';
const ref = `.runs/${readableId}/case/step.png`;
const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
const csp = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

let projectRoot: string;
let runsDir: string;
let controller: AbortController;
let closed: Promise<void> | undefined;

function plan(storage = createFsStorage(), candidates: readonly number[] = [0], strict = false): ViewPlan {
  const deps = { storage, projectRoot, runsDir };
  return {
    bindHost: '127.0.0.1', candidates, strict, warn: false,
    reader: {
      list: () => listRunReports(deps),
      get: (runId) => getRunReport(deps, runId),
      bytes: (runId) => getRunReportBytes(deps, runId),
      screenshot: (runId, screenshotRef) => getRunScreenshot(deps, runId, screenshotRef),
    },
  };
}

async function start(viewPlan = plan()): Promise<string> {
  const result = await startLocalReportServer(viewPlan, { signal: controller.signal, stderr: process.stderr });
  closed = result.closed;
  return result.url;
}

function url(base: string, path: string): string {
  return `${base.slice(0, -1)}${path}`;
}

async function rawRequest(port: number, host: string | undefined, path = '/'): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const headers = host === undefined ? {} : { Host: host };
    const request = http.request({ hostname: '127.0.0.1', port, path, method: 'GET', setHost: false, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

async function occupyPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return { port: address.port, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

beforeEach(async () => {
  controller = new AbortController();
  closed = undefined;
  projectRoot = await mkdtemp(join(tmpdir(), 'ambercast-view-http-'));
  runsDir = join(projectRoot, '.runs');
  await mkdir(join(runsDir, readableId, 'case'), { recursive: true });
  await mkdir(join(runsDir, noReportId), { recursive: true });
  await mkdir(join(runsDir, unreadableId), { recursive: true });
  const envelope = ReportEnvelope.parse({
    schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: '2026-09-23T06:40:12Z', durationMs: 42,
    summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 }, errors: [], reportPersistence: 'persisted',
    results: [{ id: 'case', file: 'case.test.md', planFile: 'case.ambercast.plan.json', status: 'passed', durationMs: 42, sessions: {},
      explanation: 'Replay completed successfully.', steps: [{ id: 'step', type: 'capture', target: 'default', status: 'passed', screenshot: ref }] }],
  });
  await writeFile(join(runsDir, readableId, 'report.json'), JSON.stringify(envelope));
  await writeFile(join(projectRoot, ref), png);
  await writeFile(join(runsDir, unreadableId, 'report.json'), '{broken');
});

afterEach(async () => {
  controller.abort();
  if (closed) await closed;
  await rm(projectRoot, { recursive: true, force: true });
});

describe('local report server real HTTP contract', () => {
  it('routes exact paths, ignores queries, and gives method rejection priority over unknown paths', async () => {
    const base = await start();
    const cases: Array<[string, number, string | undefined]> = [
      ['/', 200, 'text/html; charset=utf-8'], ['//', 404, 'text/html; charset=utf-8'],
      ['/index.html', 404, 'text/html; charset=utf-8'], ['/?x=1', 200, 'text/html; charset=utf-8'],
      [`/runs/${readableId}`, 200, 'text/html; charset=utf-8'], [`/runs/${readableId}/`, 404, 'text/html; charset=utf-8'],
      [`/runs/${noReportId}`, 404, 'text/html; charset=utf-8'], [`/runs/${unreadableId}`, 200, 'text/html; charset=utf-8'],
      ['/runs/bad%20id', 404, 'text/html; charset=utf-8'],
      [`/runs/${readableId}/report.json`, 200, 'application/json'],
      [`/runs/${unreadableId}/report.json`, 200, 'text/plain; charset=utf-8'],
      [`/runs/${readableId}/screenshots/${encodeURIComponent(ref)}`, 200, 'image/png'],
      ['/runs/%ZZ', 404, 'text/html; charset=utf-8'],
    ];
    for (const [path, status, contentType] of cases) {
      const response = await fetch(url(base, path));
      expect(response.status, path).toBe(status);
      expect(response.headers.get('content-type'), path).toBe(contentType);
      if (path.endsWith('/report.json') && path.includes(readableId)) expect(await response.json()).toMatchObject({ command: 'run' });
      else if (path.endsWith('/report.json')) expect(await response.text()).toBe('{broken');
      else if (path.includes('/screenshots/')) expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
      else await response.arrayBuffer();
    }
    for (const path of ['/', '/nonexistent']) {
      const response = await fetch(url(base, path), { method: 'POST' });
      expect(response.status, path).toBe(405);
      expect(response.headers.get('allow'), path).toBe('GET, HEAD');
    }
    const get = await fetch(base);
    const head = await fetch(base, { method: 'HEAD' });
    expect(head.status).toBe(get.status);
    expect(await head.text()).toBe('');
    for (const name of ['x-content-type-options', 'cache-control', 'content-security-policy', 'referrer-policy', 'content-type']) {
      expect(head.headers.get(name), name).toBe(get.headers.get(name));
    }
  });

  it('allows only loopback and bound hosts with the real bound port', async () => {
    const base = await start();
    const port = Number(new URL(base).port);
    // Node's HTTP/1.1 parser rejects a Host-less request before it reaches the application.
    expect((await rawRequest(port, undefined)).status).toBe(400);
    for (const host of ['', 'evil.example', `127.0.0.1:${port === 9 ? 10 : 9}`, 'localhost.evil']) {
      expect((await rawRequest(port, host)).status, String(host)).toBe(403);
    }
    for (const host of ['localhost', 'LOCALHOST.', '127.0.0.1', `127.0.0.1:${port}`, `[::1]:${port}`, new URL(base).host]) {
      expect((await rawRequest(port, host)).status, host).toBe(200);
    }
    expect((await rawRequest(port, 'evil.example', '/nonexistent')).status).toBe(403);
  });

  it('applies security headers to every response family and excludes CSP from PNG', async () => {
    let failEnumeration = false;
    const storage = createFsStorage();
    const broken = { ...storage, listDirectories: async (path: string) => {
      if (failEnumeration) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return storage.listDirectories(path);
    } };
    const base = await start(plan(broken));
    const samples: Array<[string, RequestInit | undefined, number, boolean, boolean]> = [
      ['/', undefined, 200, true, true],
      [`/runs/${readableId}`, undefined, 200, true, true],
      [`/runs/${readableId}/report.json`, undefined, 200, true, false],
      [`/runs/${unreadableId}/report.json`, undefined, 200, true, false],
      [`/runs/${readableId}/screenshots/${encodeURIComponent(ref)}`, undefined, 200, false, false],
      ['/nonexistent', undefined, 404, true, true],
      ['/', { method: 'POST' }, 405, true, true],
    ];
    for (const [path, init, status, hasCsp, html] of samples) {
      const response = await fetch(url(base, path), init);
      expect(response.status, path).toBe(status);
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('cache-control'), path).toBe('no-store');
      expect(response.headers.get('content-security-policy'), path).toBe(hasCsp ? csp : null);
      if (hasCsp) expect(response.headers.get('referrer-policy'), path).toBe('no-referrer');
      if (html) expect(response.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      await response.arrayBuffer();
    }
    const badHost = await rawRequest(Number(new URL(base).port), 'evil.example');
    expect(badHost.status).toBe(403);
    expect(badHost.headers['x-content-type-options']).toBe('nosniff');
    expect(badHost.headers['cache-control']).toBe('no-store');
    expect(badHost.headers['content-security-policy']).toBe(csp);
    expect(badHost.headers['referrer-policy']).toBe('no-referrer');
    expect(badHost.headers['content-type']).toBe('text/html; charset=utf-8');
    failEnumeration = true;
    const failed = await fetch(base);
    expect(failed.status).toBe(500);
    expect(failed.headers.get('x-content-type-options')).toBe('nosniff');
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(failed.headers.get('content-security-policy')).toBe(csp);
    expect(failed.headers.get('referrer-policy')).toBe('no-referrer');
    expect(failed.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it.each(['localhost/evil', '127.0.0.1:80'])('rejects Host %s with security headers', async (host) => {
    const base = await start();
    const port = Number(new URL(base).port);
    expect(port).not.toBe(80);
    const badHost = await rawRequest(port, host);
    expect(badHost.status).toBe(403);
    expect(badHost.headers['x-content-type-options']).toBe('nosniff');
    expect(badHost.headers['cache-control']).toBe('no-store');
    expect(badHost.headers['content-security-policy']).toBe(csp);
    expect(badHost.headers['referrer-policy']).toBe('no-referrer');
    expect(badHost.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('returns the fixed 500 copy for an enumeration failure and keeps serving', async () => {
    let failOnce = true;
    const storage = createFsStorage();
    const broken = { ...storage, listDirectories: async (path: string) => {
      if (failOnce) { failOnce = false; throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
      return storage.listDirectories(path);
    } };
    const base = await start(plan(broken));
    const failed = await fetch(url(base, `/runs/${readableId}`));
    expect(failed.status).toBe(500);
    const body = await failed.text();
    expect(body).toContain('Read failed');
    expect(body).toContain('Reload to retry');
    expect((await fetch(base)).status).toBe(200);
  });

  it('distinguishes invalid and absent run IDs in 404 bodies', async () => {
    const base = await start();
    const invalid = await fetch(url(base, '/runs/bad%20id'));
    expect(invalid.status).toBe(404);
    expect(await invalid.text()).toContain(VIEW_COPY.errorPages.notFound.noSuchPage);

    const absentId = '20260923T064013Z-absent';
    const absent = await fetch(url(base, `/runs/${absentId}`));
    expect(absent.status).toBe(404);
    expect(await absent.text()).toContain(`No run &quot;${absentId}&quot;`);
  });

  it('renders a report read error as unreadable detail rather than a server error', async () => {
    const storage = createFsStorage();
    const broken = { ...storage, readText: async (path: string) => {
      if (path === join(runsDir, readableId, 'report.json')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return storage.readText(path);
    } };
    const base = await start(plan(broken));
    const response = await fetch(url(base, `/runs/${readableId}`));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(VIEW_COPY.detail.unreadable.heading);
    expect(body).toContain(VIEW_COPY.list.cases.unreadableReasons.readFailed);
  });

  it('decodes a screenshot reference only once', async () => {
    const base = await start();
    const response = await fetch(url(base, `/runs/${readableId}/screenshots/${encodeURIComponent(encodeURIComponent(ref))}`));
    expect(response.status).toBe(404);
  });

  it('returns 404 when a report disappears after its run was listed', async () => {
    const base = await start();
    expect((await fetch(base)).status).toBe(200);
    await unlink(join(runsDir, readableId, 'report.json'));
    const response = await fetch(url(base, `/runs/${readableId}`));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain(`No run &quot;${readableId}&quot;`);
  });

  it('rejects a strict candidate occupied by a real TCP listener', async () => {
    const occupied = await occupyPort();
    try {
      await expect(startLocalReportServer(plan(createFsStorage(), [occupied.port], true), {
        signal: controller.signal, stderr: process.stderr,
      })).rejects.toMatchObject({ message: `Port ${occupied.port} on 127.0.0.1 is in use.`, exitCode: 3 });
    } finally {
      await occupied.close();
    }
  });
});
