import { createServer, type Server } from 'node:http';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { GroundingDocument, PlanDocument, type JsonValueT, type TargetDefinition } from '#core/ir/schema.js';
import { createAgenticClaudeSentinel, type AgenticClaudeSentinelMode } from './support/agentic-claude-sentinel.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { createCleanupRegistry } from './support/cleanup-registry.js';
import { spawnSupervisedCli, type SupervisedCli } from './support/supervised-cli.js';

const FIRST_REQUIREMENT = 'Complete first verification.';
const SECOND_REQUIREMENT = 'Complete second verification.';
const PROMPT = `# Agentic partial trace fixture\n\n${FIRST_REQUIREMENT}\n${SECOND_REQUIREMENT}\n`;

let chromiumAvailable = false;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The agentic fixture server did not expose a TCP address.');
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

async function waitForFile(path: string): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (true) {
    try {
      await access(path);
      return;
    } catch {
      if (performance.now() >= deadline) {
        throw new Error('The hanging agentic provider did not complete its MCP tool round-trip.');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function writeFixture(project: string, baseUrl: string): Promise<string> {
  const tests = join(project, 'tests');
  await mkdir(tests);
  const targets = { fixture: { baseUrl, browser: 'chromium' } } as const satisfies Record<string, TargetDefinition>;
  const plan = PlanDocument.parse({
    schemaVersion: 3,
    source: {
      inputsDigest: computeInputsDigest({
        normalizedTestMd: normalizeTestMd(PROMPT), schemaVersion: 3,
        generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
        planProducerBundleFingerprint: planProducerBundleFingerprint(), targetDefinitions: targets,
      }),
    },
    targets,
    steps: [
      {
        id: 'first-complete', kind: 'ai', instruction: 'Verify the fixture.',
        instructionCoverage: [{ id: 'first-complete', kind: 'success', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: FIRST_REQUIREMENT.length + 1 } }],
      },
      {
        id: 'second-complete', kind: 'ai', instruction: 'Verify the fixture again.',
        instructionCoverage: [{ id: 'second-complete', kind: 'success', sourceSpan: { startLine: 4, startColumn: 1, endLine: 4, endColumn: SECOND_REQUIREMENT.length + 1 } }],
      },
    ],
  });
  const grounding = GroundingDocument.parse({ schemaVersion: 1, planDigest: computePlanDigest(plan), entries: {} });
  const groundingPath = join(tests, 'agentic-partial.ambercast.grounding.json');
  await Promise.all([
    writeFile(join(project, 'ambercast.config.json'), JSON.stringify({
      $schema: 'https://ambercast.dev/schema/config.json', testDir: 'tests', runsDir: 'tests/.runs',
      targets, defaultTarget: 'fixture', ai: { provider: 'codex' }, ci: { heal: false },
    })),
    writeFile(join(tests, 'agentic-partial.test.md'), PROMPT),
    writeFile(join(tests, 'agentic-partial.ambercast.plan.json'), toCanonicalArtifactText(plan as unknown as JsonValueT)),
    writeFile(groundingPath, toCanonicalArtifactText(grounding as unknown as JsonValueT)),
  ]);
  return groundingPath;
}

async function expectFirstTraceOnly(groundingPath: string): Promise<void> {
  const grounding = GroundingDocument.parse(JSON.parse(await readFile(groundingPath, 'utf8')));
  expect(Object.keys(grounding.entries)).toEqual(['first-complete']);
  expect(grounding.entries['first-complete']?.kind).toBe('ai');
  expect(grounding.entries['second-complete']).toBeUndefined();
}

async function runPartialTraceCase(
  mode: Exclude<AgenticClaudeSentinelMode, 'success'>,
  interrupt?: (invocation: SupervisedCli, readyPath: string) => Promise<void>,
): Promise<void> {
  const registry = createCleanupRegistry();
  await registry.run(async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="en"><body><main>Agentic fixture ready</main></body></html>');
    });
    registry.deferResource(() => closeServer(server));
    const port = await listen(server);
    const project = await mkdtemp(join(tmpdir(), 'ambercast-agentic-partial-'));
    registry.deferResource(() => rm(project, { recursive: true, force: true }));
    const groundingPath = await writeFixture(project, `http://127.0.0.1:${port}`);
    const sentinel = await createAgenticClaudeSentinel(['success', mode]);
    registry.deferResource(() => sentinel.cleanup());
    const invocation = spawnSupervisedCli(['run', '--resolve', '--update-cache', '--ai', 'claude', '--json'], project, {
      ...process.env, PATH: `${sentinel.pathEntry}:${process.env.PATH ?? ''}`, CI: 'true',
    });
    registry.registerSupervisor(invocation);
    if (interrupt !== undefined) await interrupt(invocation, sentinel.readyPath);
    const result = await invocation.result;
    await invocation.terminateAndConfirm();
    expect(result.exitCode).not.toBe(0);
    expect(result.signalCode).toBeNull();
    expect(invocation.terminated()).toBe(true);
    const providerInvocations = (await sentinel.invocations()).filter((argv) => argv[0] === '-p');
    expect(providerInvocations).toHaveLength(2);
    await expectFirstTraceOnly(groundingPath);
  });
}

describe('agentic real-browser partial trace discard through the built CLI', () => {
  beforeAll(async () => {
    if (process.platform === 'win32') return;
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });

  beforeEach((context) => {
    if (process.platform === 'win32') context.skip('This POSIX-only contract uses a PATH sentinel and process-group termination.');
    if (!chromiumAvailable) context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
  });

  it('preserves an earlier trace and discards the in-flight trace when SIGTERM aborts the CLI AbortSignal', async () => {
    await runPartialTraceCase('hang-after-perform', async (invocation, readyPath) => {
      await waitForFile(readyPath);
      if (invocation.child.pid === undefined) throw new Error('The supervised CLI did not expose a PID.');
      process.kill(invocation.child.pid, 'SIGTERM');
    });
  }, 90_000);

  it('preserves an earlier trace and discards the in-flight trace after provider abnormal termination', async () => {
    await runPartialTraceCase('exit-after-perform');
  }, 90_000);

  it('preserves an earlier trace and discards the in-flight trace after malformed provider final output', async () => {
    await runPartialTraceCase('malformed-after-success');
  }, 90_000);
});
