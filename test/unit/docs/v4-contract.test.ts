import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const expected = JSON.parse(readFileSync(new URL('../../fixtures/docs-v4-expectations.json', import.meta.url), 'utf8')) as {
  versions: { plan: string; grounding: string; report: string };
  elementSteps: string[];
  assertChecks: string[];
  cliWithoutTarget: string[];
};
const spec = (name: string) => readFileSync(new URL(`../../../docs/spec/${name}.md`, import.meta.url), 'utf8');
const reference = (name: string) => readFileSync(new URL(`../../../website/src/content/docs/reference/${name}.md`, import.meta.url), 'utf8');

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
    expect(freshness).toMatch(/browser[^\n]*(?:not|excluded|omit)/i);
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
    expect(config).toMatch(/`defaultTarget`[^\n]*(?:generat|prompt)/i);
  });
});
