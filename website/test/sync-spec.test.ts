import { afterEach, describe, expect, it } from 'vitest';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

describe('sync-spec CLI entry point', () => {
  it('generates a transformed root-locale chapter without diagnostics', () => {
    const fixture = createDocsFixture({
      'package.json': '{"version":"0.3.1"}\n',
      'website/.fixture': '',
      'docs/spec/overview.md': '# Overview\n\nThe generated overview is ready. More detail follows.\n',
      'docs/spec/changelog.md': '# Changelog\n\nWrong first paragraph.\n\n## Compatibility policy {#compatibility-policy}\n\nCompatibility starts here. More detail follows.\n',
    });
    fixtures.push(fixture);

    const result = runEntryPoint(new URL('../scripts/sync-spec.mjs', import.meta.url), fixture.website);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    const output = fixture.read('website/src/content/docs/spec/overview.md');
    expect(output).toContain('title: "Overview"');
    expect(output).toContain('description: "The generated overview is ready."');
    expect(output).toContain('The generated overview is ready. More detail follows.');
    expect(fixture.read('website/src/content/docs/spec/changelog.md')).toContain('description: "Compatibility starts here."');
  });

  it('aggregates invalid chapters, exits non-zero, and does not partially replace generated pages', () => {
    const fixture = createDocsFixture({
      'package.json': '{"version":"0.3.1"}\n',
      'docs/spec/overview.md': '# Overview\n\n[[missing-overview]]\n',
      'docs/spec/steps.md': '# One\n\nBody.\n\n# Two\n',
      'website/src/content/docs/spec/overview.md': 'old overview\n',
      'website/src/content/docs/spec/steps.md': 'old steps\n',
    });
    fixtures.push(fixture);
    const before = [fixture.read('website/src/content/docs/spec/overview.md'), fixture.read('website/src/content/docs/spec/steps.md')];

    const result = runEntryPoint(new URL('../scripts/sync-spec.mjs', import.meta.url), fixture.website);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n').sort()).toEqual([
      'overview.md: unresolved wikilink "missing-overview"',
      'steps.md: expected exactly one H1',
    ]);
    expect([fixture.read('website/src/content/docs/spec/overview.md'), fixture.read('website/src/content/docs/spec/steps.md')]).toEqual(before);
  });
});
