import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RawConfig } from '../../../src/core/config/schema.js';
// @ts-expect-error The website's .mjs script has no TypeScript declaration.
import { main as syncSpec } from '../../../website/scripts/sync-spec.mjs';

const expected = JSON.parse(readFileSync(new URL('../../fixtures/docs-v4-expectations.json', import.meta.url), 'utf8')) as {
  versions: { plan: string; grounding: string; report: string };
  elementSteps: string[];
  assertChecks: string[];
  cliWithoutTarget: string[];
};
const spec = (name: string) => readFileSync(new URL(`../../../docs/spec/${name}.md`, import.meta.url), 'utf8');
const reference = (name: string) => readFileSync(new URL(`../../../website/src/content/docs/reference/${name}.md`, import.meta.url), 'utf8');
const localizedDoc = (locale: string, name: string) => readFileSync(new URL(`../../../website/src/content/docs/${locale}${name}.md`, import.meta.url), 'utf8');

function trackedMatches(pattern: string, paths: readonly string[]): string[] {
  const result = spawnSync('git', ['grep', '-l', pattern, '--', ...paths], {
    cwd: new URL('../../../', import.meta.url), encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect([0, 1]).toContain(result.status);
  return result.stdout.trim() === '' ? [] : result.stdout.trim().split('\n').sort();
}

describe('TP3 source vocabulary', () => {
  it('keeps the synced EN changelog page in sync with docs/spec/changelog.md (TEST-12)', async () => {
    const enChangelogPath = new URL('../../../website/src/content/docs/spec/changelog.md', import.meta.url);
    let before: string;
    try {
      before = await readFile(enChangelogPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const originalExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      await syncSpec({ websiteRoot: fileURLToPath(new URL('../../../website/', import.meta.url)) });
      expect(process.exitCode).toBeUndefined();
      expect(await readFile(enChangelogPath, 'utf8')).toBe(before);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('records the TP3 contract and matching evidence in each specification changelog', () => {
    const tp3Row = (document: string) => document.split('\n').find((line) => line.startsWith('| TP3'));
    const english = tp3Row(spec('changelog'));
    expect(english).toBeDefined();
    expect(english).toMatch(/executor kind vocabulary[^|]*total registry/i);
    expect(english).toMatch(/unreachable[^|]*executor-unregistered/i);
    expect(english).toMatch(/element step[^|]*GROUNDING_UNRESOLVED/i);
    expect(english).toMatch(/Plan v4, grounding v2, and the config schema are unchanged; report 3\.7 only narrows the browser launch reason enum/i);

    const evidence = [
      'repo:src/core/executor/kinds.ts',
      'repo:src/adapters/browser/registry.ts',
      'repo:src/usecases/run.ts',
      'repo:src/report/schema.ts',
    ];
    for (const locale of ['ja/', 'zh-cn/']) {
      const translated = tp3Row(localizedDoc(locale, 'spec/changelog'));
      expect(translated, locale).toBeDefined();
      for (const identifier of evidence) {
        expect(english, identifier).toContain(identifier);
        expect(translated, `${locale}${identifier}`).toContain(identifier);
      }
      for (const term of ['executor-unregistered', 'GROUNDING_UNRESOLVED', 'Plan v4', 'grounding v2', 'config schema', 'report 3.7']) {
        expect(translated, `${locale}${term}`).toContain(term);
      }
    }
  });

  it('retains executor-unregistered only in the historical specification changelogs', () => {
    expect(trackedMatches('executor-unregistered', ['src', 'website/src/content/docs', 'docs/spec'])).toEqual([
      'docs/spec/changelog.md',
      'website/src/content/docs/ja/spec/changelog.md',
      'website/src/content/docs/zh-cn/spec/changelog.md',
    ]);
  });

  it('removes ChromiumBrowserDriver from source, including comments', () => {
    expect(trackedMatches('ChromiumBrowserDriver', ['src'])).toEqual([]);
  });
});

describe('TEST-21 v4 documentation golden expectations', () => {
  it('documents target names and element references in all eight step examples', () => {
    const steps = spec('steps');
    for (const discriminator of expected.elementSteps) {
      const heading = discriminator === 'capture' ? '### `capture`' : discriminator.includes('visible') || discriminator.includes('equals') || discriminator === 'element-count'
        ? `### \`assert\` / \`${discriminator}\`` : `### \`action\` / \`${discriminator}\``;
      const section = steps.split(heading)[1]?.split(/^### /m)[0];
      expect(section, heading).toBeDefined();
      expect(section, heading).toMatch(/\| `target` \| (?:string|`TargetName`)/);
      expect(section, heading).toMatch(/\| `element` \| `ElementRef`/);
      expect(section, heading).toMatch(/"target":"[^"]+"/);
      expect(section, heading).toMatch(/"element":\{"strategy":"accessibility"/);
    }
    for (const check of expected.assertChecks) {
      const section = steps.split(`### \`assert\` / \`${check}\``)[1]?.split(/^### /m)[0];
      expect(section, check).toMatch(/\| `timeoutMs` \|/);
    }
    expect(steps).toMatch(/poll(?:ing)?/i);
    expect(steps).toMatch(/100\s*ms/);
  });

  it('documents v4 plan, v2 grounding, and executor-free target definitions', () => {
    const plan = spec('plan-document');
    expect(plan).toContain(`literal \`${expected.versions.plan}\``);
    expect(plan).toMatch(/"schemaVersion":\s*4/);
    expect(plan).toMatch(/"surface":\s*"web"/);
    expect(plan).not.toMatch(/"browser":\s*"chromium"/);
    const values = spec('value-types');
    expect(values).toMatch(/`TargetDefinition`[^\n]*`surface`/);
    expect(values).not.toMatch(/\|\s*`browser`\s*\|/);
    const grounding = spec('grounding-document');
    expect(grounding).toContain(`literal \`${expected.versions.grounding}\``);
    expect(grounding).toMatch(/"schemaVersion":\s*2/);
    expect(grounding).toContain('`element`');
    expect(grounding).not.toMatch(/`target`,\s*`(?:key|value|text|count)`/);
  });

  it('documents referenced target projection, fixed vocabulary, and version history', () => {
    const freshness = spec('freshness');
    expect(freshness).toMatch(/(?:referenced|used)[^\n]*Target/i);
    expect(freshness).toMatch(/(?:unreferenced|unused)[^\n]*(?:stale|digest)/i);
    expect(freshness).toMatch(/executor[^\n]*(?:not|excluded|omit)/i);
    const conformance = spec('conformance');
    for (const row of ['CON-19', 'CON-22']) {
      const line = conformance.split('\n').find((value) => value.startsWith(`| ${row} |`));
      expect(line, row).toMatch(/`target`/);
      expect(line, row).toMatch(/`timeoutMs`/);
    }
    const changelog = spec('changelog');
    expect(changelog).toMatch(/(?:Plan|plan)[^\n]*v4|v4[^\n]*(?:Plan|plan)/);
    expect(changelog).toMatch(/(?:grounding|Grounding)[^\n]*v2|v2[^\n]*(?:grounding|Grounding)/);
    expect(changelog).toContain(expected.versions.report);
  });

  it('keeps --target only on generate and explains config target semantics', () => {
    for (const command of expected.cliWithoutTarget) expect(reference(`cli/${command}`), command).not.toContain('--target');
    const overview = reference('cli/overview');
    for (const command of expected.cliWithoutTarget) {
      const line = overview.split('\n').find((value) => value.includes(`ambercast ${command} `));
      expect(line, command).not.toContain('--target');
    }
    expect(reference('glossary')).not.toContain('--target');
    expect(reference('cli/generate')).toMatch(/--target[^\n]*(?:limit|restrict|only)/i);
    const config = reference('configuration');
    expect(config).toContain('`targets.<name>.surface`');
    expect(config).toContain('`targets.<name>.description`');
    expect(config).toContain('`targets.<name>.executor.kind`');
    expect(config).toContain('`targets.<name>.executor.browser`');
    expect(config).not.toContain('`targets.<name>.browser`');
    expect(config).toMatch(/`defaultTarget`[^\n]*(?:generat|prompt)/i);
  });

  it('keeps localized target examples valid under the executor config contract', () => {
    for (const locale of ['', 'ja/', 'zh-cn/']) {
      const configuration = localizedDoc(locale, 'reference/configuration');
      const errorCodes = localizedDoc(locale, 'reference/error-codes');
      expect(configuration, locale).toContain('`targets.<name>.executor.kind`');
      expect(configuration, locale).toContain('`targets.<name>.executor.browser`');
      expect(configuration, locale).not.toContain('`targets.<name>.browser`');
      expect(errorCodes, locale).toMatch(/^\| EXECUTOR_UNSUPPORTED \| usage \| case \| 2 \|/m);
      const howTo = localizedDoc(locale, 'how-to/configure-targets');
      const tutorial = localizedDoc(locale, 'tutorials/repair-your-first-drift');
      const inlineExample = howTo.match(/`(\{"\$schema":.+?\})`/)?.[1];
      const fencedExample = tutorial.match(/```json\n([^\n]+)\n```/)?.[1];
      expect(inlineExample, locale).toBeDefined();
      expect(fencedExample, locale).toBeDefined();
      for (const example of [inlineExample, fencedExample]) {
        const parsed = JSON.parse(example!);
        expect(RawConfig.safeParse(parsed).success, locale).toBe(true);
        expect(parsed.targets?.staging?.browser, locale).toBeUndefined();
        expect(parsed.targets?.admin?.browser, locale).toBeUndefined();
        expect(parsed.targets?.['web-user']?.browser, locale).toBeUndefined();
      }
      expect(inlineExample, locale).toContain('"executor":{"kind":"playwright","browser":"chromium"}');
    }
    expect(spec('freshness')).toContain('config `executor`');
    expect(spec('changelog')).toContain('TP2');
  });
});
