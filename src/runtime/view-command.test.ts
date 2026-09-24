import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../core/config/schema.js';
import { ConfigInvalidError } from '../core/errors/config-invalid-error.js';
import { createInMemoryStorage } from '../../test/doubles/create-in-memory-storage.js';
import { prepareViewCommand, type ViewCommandDeps, type ViewCommandInput } from './view-command.js';

const mocks = vi.hoisted(() => ({
  createFsStorage: vi.fn(),
  loadConfig: vi.fn(),
  listRunReports: vi.fn(),
  getRunReport: vi.fn(),
  getRunReportBytes: vi.fn(),
  getRunScreenshot: vi.fn(),
}));

vi.mock('../adapters/storage/fs-storage.js', () => ({ createFsStorage: mocks.createFsStorage }));
vi.mock('../config/load.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../usecases/get-run-report.js', () => ({
  listRunReports: mocks.listRunReports,
  getRunReport: mocks.getRunReport,
  getRunReportBytes: mocks.getRunReportBytes,
  getRunScreenshot: mocks.getRunScreenshot,
}));

const CONFIG: ResolvedConfig = {
  testDir: '/workspace/tests', runsDir: '/workspace/tests/.runs', projectRoot: '/workspace',
  testMatch: ['**/*.test.md'], testIgnore: ['**/.runs/**'],
  targets: { web: { baseUrl: 'https://example.test', executor: { kind: 'playwright', browser: 'chromium' }, healReplayIsolation: 'idempotent', resolveTimeoutMs: 5000 } },
  defaultTarget: 'web', secrets: { allow: [] },
  ai: { provider: 'auto', timeoutMs: 120_000, maxGenerateAttempts: 2 },
  viewer: { port: 5000 }, ci: { heal: true, updateGroundingCache: false },
  grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
  heal: { caseTimeoutMs: 300_000 },
};

const stderr = { write: vi.fn() } as unknown as NodeJS.WritableStream;
type LooseViewCommandInput = { readonly [K in keyof ViewCommandInput]?: ViewCommandInput[K] | undefined };
function input(overrides: LooseViewCommandInput = {}): ViewCommandInput {
  const cleaned = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<ViewCommandInput>;
  return { cwd: '/workspace', stderr, allowHeadless: false, ...cleaned };
}
function deps(overrides: Partial<ViewCommandDeps> = {}): ViewCommandDeps {
  return {
    isCI: false,
    isInteractive: () => true,
    isIpAddress: (value) => value === '::1' || value === '::' ? 6 : /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) ? 4 : 0,
    ...overrides,
  };
}

beforeEach(() => {
  const storage = createInMemoryStorage();
  mocks.createFsStorage.mockReturnValue(storage);
  mocks.loadConfig.mockResolvedValue({ resolved: CONFIG, source: { path: null } });
  mocks.listRunReports.mockResolvedValue([]);
  mocks.getRunReport.mockResolvedValue({ kind: 'not-found' });
  mocks.getRunReportBytes.mockResolvedValue({ kind: 'not-found' });
  mocks.getRunScreenshot.mockResolvedValue({ kind: 'not-found' });
});
afterEach(() => vi.resetAllMocks());

describe('prepareViewCommand', () => {
  it.each([
    { isCI: false, interactive: false },
    { isCI: true, interactive: true },
    { isCI: true, interactive: false },
  ])('rejects headless use without opt-in (CI=$isCI, TTY=$interactive)', async ({ isCI, interactive }) => {
    await expect(prepareViewCommand(input(), deps({ isCI, isInteractive: () => interactive })))
      .rejects.toThrow(new ConfigInvalidError('view requires --allow-headless when no interactive terminal is attached.'));
  });

  it.each([
    { isCI: false, interactive: false, allowHeadless: true },
    { isCI: true, interactive: true, allowHeadless: true },
    { isCI: false, interactive: true, allowHeadless: false },
    { isCI: false, interactive: true, allowHeadless: true },
  ])('prepares a plan for allowed terminal policy %#', async ({ isCI, interactive, allowHeadless }) => {
    await expect(prepareViewCommand(input({ allowHeadless }), deps({ isCI, isInteractive: () => interactive })))
      .resolves.toMatchObject({ bindHost: '127.0.0.1', strict: false, warn: false });
  });

  it.each(['0.0.0.0', '::', '[::]'])('rejects wildcard host %s even with headless opt-in', async (host) => {
    await expect(prepareViewCommand(input({ host, allowHeadless: true }), deps({ isCI: true, isInteractive: () => false })))
      .rejects.toThrow(new ConfigInvalidError('The --host value must be a specific address, not a wildcard.'));
  });

  it.each(['example.com', '127.0.0.1:80', ''])('rejects invalid host %j', async (host) => {
    await expect(prepareViewCommand(input({ host }), deps()))
      .rejects.toThrow(new ConfigInvalidError('The --host value must be an IP address or localhost.'));
  });

  it.each([
    { host: undefined, bindHost: '127.0.0.1', warn: false },
    { host: 'localhost', bindHost: '127.0.0.1', warn: false },
    { host: '127.0.0.1', bindHost: '127.0.0.1', warn: false },
    { host: '::1', bindHost: '::1', warn: false },
    { host: '192.0.2.10', bindHost: '192.0.2.10', warn: true },
  ])('normalizes host $host and warning policy', async ({ host, bindHost, warn }) => {
    await expect(prepareViewCommand(input({ host }), deps())).resolves.toMatchObject({ bindHost, warn });
  });

  it('starts twenty fallback candidates at the configured viewer port', async () => {
    const plan = await prepareViewCommand(input(), deps());
    expect(plan.candidates).toEqual(Array.from({ length: 20 }, (_, offset) => 5000 + offset));
    expect(plan.strict).toBe(false);
  });

  it('uses only the explicit port and disables fallback', async () => {
    const plan = await prepareViewCommand(input({ port: 6000 }), deps());
    expect(plan.candidates).toEqual([6000]);
    expect(plan.strict).toBe(true);
  });

  it.each([65516, 65535])('truncates configured candidates at the TCP maximum from %i', async (port) => {
    mocks.loadConfig.mockResolvedValue({ resolved: { ...CONFIG, viewer: { port } }, source: { path: null } });
    const plan = await prepareViewCommand(input(), deps());
    expect(plan.candidates).toEqual(Array.from({ length: 65536 - port }, (_, offset) => port + offset));
  });

  it('passes cwd and explicit config path to the shared loader', async () => {
    await prepareViewCommand(input({ cwd: '/another', configPathOverride: 'custom.json' }), deps());
    expect(mocks.loadConfig).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/another', configPathOverride: 'custom.json',
    }));
  });

  it('binds all four reader operations to one resolved storage and roots', async () => {
    const storage = createInMemoryStorage();
    const listDirectories = vi.spyOn(storage, 'listDirectories');
    mocks.createFsStorage.mockReturnValue(storage);
    mocks.listRunReports.mockImplementation(async ({ storage: bound, runsDir }: { storage: ReturnType<typeof createInMemoryStorage>; runsDir: string }) => {
      await bound.listDirectories(runsDir);
      return [];
    });
    const plan = await prepareViewCommand(input(), deps());
    await plan.reader.list();
    await plan.reader.get('run-1');
    await plan.reader.bytes('run-1');
    await plan.reader.screenshot('run-1', 'shot.png');
    expect(listDirectories).toHaveBeenCalledWith(CONFIG.runsDir);
    const bound = expect.objectContaining({ storage, runsDir: CONFIG.runsDir, projectRoot: CONFIG.projectRoot });
    expect(mocks.listRunReports).toHaveBeenCalledWith(bound);
    expect(mocks.getRunReport).toHaveBeenCalledWith(bound, 'run-1');
    expect(mocks.getRunReportBytes).toHaveBeenCalledWith(bound, 'run-1');
    expect(mocks.getRunScreenshot).toHaveBeenCalledWith(bound, 'run-1', 'shot.png');
  });
});
