/// <reference lib="dom" />
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startLocalReportServer } from '#adapters/http/local-report-server.js';
import { createFsStorage } from '#adapters/storage/fs-storage.js';
import { REPORT_SCHEMA_VERSION, ReportEnvelope } from '#report/schema.js';
import type { ViewPlan } from '#runtime/view-command.js';
import { getRunReport, getRunReportBytes, getRunScreenshot, listRunReports } from '#usecases/get-run-report.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { solidPng } from './support/png.js';

const runId = '20260924T120000Z-layout';
const longRunId = 'A'.repeat(120);
const caseId = 'case';
const stepId = 'step';
const ref = `.runs/${runId}/${caseId}/${stepId}.png`;

let chromiumAvailable = false;

beforeAll(async () => {
  chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
});

beforeEach((context) => {
  if (!chromiumAvailable) {
    context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
  }
});

let projectRoot: string;
let runsDir: string;
let controller: AbortController;
let closed: Promise<void> | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;

function plan(): ViewPlan {
  const deps = { storage: createFsStorage(), projectRoot, runsDir };
  return {
    bindHost: '127.0.0.1', candidates: [0], strict: false, warn: false,
    reader: {
      list: () => listRunReports(deps),
      get: (id) => getRunReport(deps, id),
      bytes: (id) => getRunReportBytes(deps, id),
      screenshot: (id, screenshotRef) => getRunScreenshot(deps, id, screenshotRef),
    },
  };
}

async function writeRun(id: string, withScreenshot = false): Promise<void> {
  const screenshotRef = `.runs/${id}/${caseId}/${stepId}.png`;
  const envelope = ReportEnvelope.parse({
    schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: '2026-09-24T12:00:00Z', durationMs: 42,
    summary: { total: 1, passed: 0, failed: 1, errored: 0, skipped: 0 }, errors: [], reportPersistence: 'persisted',
    results: [{ id: caseId, file: 'case.test.md', planFile: 'case.ambercast.plan.json', status: 'failed', durationMs: 42,
      sessions: {}, explanation: 'Assertion failed.',
      steps: [{ id: stepId, type: 'assert', target: 'default', status: 'failed', expected: 'x'.repeat(200),
        ...(withScreenshot ? { screenshot: screenshotRef } : {}) }],
    }],
  });
  await mkdir(join(runsDir, id, caseId), { recursive: true });
  await writeFile(join(runsDir, id, 'report.json'), JSON.stringify(envelope));
  if (withScreenshot) await writeFile(join(projectRoot, screenshotRef), solidPng(1280, 720));
}

beforeEach(async () => {
  controller = new AbortController();
  closed = undefined;
  browser = undefined;
  context = undefined;
  page = undefined;
  projectRoot = await mkdtemp(join(tmpdir(), 'ambercast-view-layout-'));
  runsDir = join(projectRoot, '.runs');
  await writeRun(runId, true);
});

afterEach(async () => {
  await context?.close();
  await browser?.close();
  controller.abort();
  if (closed) await closed;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

async function openViewer(): Promise<string> {
  const server = await startLocalReportServer(plan(), { signal: controller.signal, stderr: process.stderr });
  closed = server.closed;
  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 800 });
  return server.url;
}

describe('view layout in real Chromium', () => {
  it('TEST-E4 contains the detail table and thumbnail, and the short-run list', async () => {
    const base = await openViewer();
    await page!.goto(new URL(`/runs/${runId}`, base).href);
    await page!.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('a.shot img');
      return image && image.complete && image.naturalHeight > 0;
    });
    const layout = await page!.evaluate(() => {
      const table = document.querySelector('section table')!;
      const image = document.querySelector<HTMLImageElement>('a.shot img')!;
      const anchor = document.querySelector<HTMLAnchorElement>('a.shot')!;
      const rectangle = image.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        headerRights: [...table.querySelectorAll('th')].map((heading) => heading.getBoundingClientRect().right),
        tableWidth: table.getBoundingClientRect().width,
        imageWidth: rectangle.width,
        imageHeight: rectangle.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        href: anchor.getAttribute('href'),
      };
    });
    expect(layout.naturalWidth).toBe(1280);
    expect(layout.naturalHeight).toBe(720);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.headerRights).toHaveLength(4);
    for (const right of layout.headerRights) expect(right).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.imageHeight).toBeLessThanOrEqual(320);
    expect(layout.imageWidth).toBeLessThanOrEqual(layout.tableWidth);
    expect(new URL(layout.href!, base).pathname).toBe(`/runs/${runId}/screenshots/${encodeURIComponent(ref)}`);

    await page!.goto(base);
    const list = await page!.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  });

  it('TEST-E5 opens the original PNG in a new tab', async () => {
    const base = await openViewer();
    await page!.goto(new URL(`/runs/${runId}`, base).href);
    const [popup] = await Promise.all([context!.waitForEvent('page'), page!.locator('a.shot').click()]);
    await popup.waitForLoadState();
    expect(new URL(popup.url()).pathname).toBe(`/runs/${runId}/screenshots/${encodeURIComponent(ref)}`);
    const response = await context!.request.get(popup.url());
    expect(response.headers()['content-type']).toBe('image/png');
    const body = await response.body();
    expect(Buffer.compare(body, Buffer.from(solidPng(1280, 720)))).toBe(0);
  });

  it('TEST-E6 contains a 120-character run ID on the list page', async () => {
    await writeRun(longRunId);
    const base = await openViewer();
    await page!.goto(base);
    const list = await page!.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      runShown: document.body.textContent?.includes('A'.repeat(120)),
    }));
    expect(longRunId).toHaveLength(120);
    expect(list.runShown).toBe(true);
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  });
});
