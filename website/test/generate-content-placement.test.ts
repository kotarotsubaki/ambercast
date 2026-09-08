import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createDocsFixture } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
const script = new URL('../scripts/generate-content-placement.mjs', import.meta.url);
const plannedPages = [
  'agents/mcp-server',
  'agents/official-skill',
  'reference/cli/baseline-restore',
  'reference/cli/init',
  'reference/cli/mcp',
  'reference/cli/review',
  'reference/cli/view',
  'reference/mcp-tools',
];
const fencePages = [
  'how-to/choose-ai-provider',
  'how-to/control-grounding-writeback',
  'how-to/manage-artifacts-in-git',
  'how-to/write-effective-prompts',
  'tutorials/quick-start',
  'tutorials/repair-your-first-drift',
];

afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

function runPlacement(root: string, handoff: string) {
  return spawnSync(process.execPath, [script.pathname], {
    cwd: `${root}/website`,
    encoding: 'utf8',
    env: { ...process.env, AMBERCAST_CONTENT_HANDOFF: handoff },
  });
}

function outputPath(locale: string, page: string) {
  return `website/src/content/docs/${locale ? `${locale}/` : ''}${page}.md`;
}

function sourcePath(locale: string, page: string) {
  return `handoff/content/${locale}/${page}.md`;
}

function plannedSource(title: string) {
  return `---\ntitle: ${title}\ndescription: Planned feature that is not implemented in 0.2.0.\nsidebar:\n  badge:\n    text: Planned\n    variant: caution\n---\n\nThis planned page is not implemented in 0.2.0.\n`;
}

function expectedPlanned(title: string) {
  return `---\ntitle: ${title}\ndescription: Planned feature that is not implemented in 0.3.1.\nstatus: planned\nsidebar:\n  badge:\n    text: Planned\n    variant: caution\n---\n\nThis planned page is not implemented in 0.3.1.\n`;
}

function fenceSource(title: string, fences: string[]) {
  return `---\ntitle: ${title}\n---\n\n${fences.map((fence) => `\`\`\`bash\n${fence}\`\`\``).join('\n\n')}\n`;
}

function fencedBodies(markdown: string) {
  return [...markdown.matchAll(/^ {0,3}(?<marker>`{3,}|~{3,})[^\n]*\n(?<body>[\s\S]*?)^ {0,3}\k<marker>[ \t]*$/gm)]
    .map((match) => match.groups?.body);
}

describe('generate-content-placement CLI entry point', () => {
  it('places a representative en/ja/zh-cn/docs-spec fixture subset with byte-identical transforms', () => {
    const files: Record<string, string> = {
      'website/.fixture': '',
      'handoff/docs-spec/overview.md': '# Overview\n\nThis specification describes ambercast 0.2.0 and 0.2.0-in-0.2.0. [vault:obsolete note] [repo:src/core/ir/schema.ts:57]\n',
      'handoff/content/en/explanation/status-and-roadmap.md': '---\ntitle: Status\ndescription: ambercast 0.2.0 current status.\n---\n\n## Implemented in 0.2.0 {#implemented-in-0-2-0}\n\nThe 0.2.0 CLI parser is current.\n',
      'handoff/content/ja/explanation/status-and-roadmap.md': '---\ntitle: 状態\ndescription: ambercast 0.2.0 の現在の状態。\n---\n\n## 0.2.0で実装済み {#implemented-in-0-2-0}\n\n0.2.0 は現行版です。\n',
      'handoff/content/zh-cn/explanation/status-and-roadmap.md': '---\ntitle: 状态\ndescription: ambercast 0.2.0 当前状态。\n---\n\n## 0.2.0 已实现 {#implemented-in-0-2-0}\n\n0.2.0 是当前版本。\n',
      'handoff/content/en/reference/security-policy.md': '---\ntitle: Security\n---\n\nReport at https://github.com/Tsubaki01/ambercast/security/advisories/new.\n',
      'handoff/content/ja/reference/security-policy.md': '---\ntitle: セキュリティ\n---\n\nhttps://github.com/Tsubaki01/ambercast/security/advisories/new へ報告します。\n',
      'handoff/content/zh-cn/reference/security-policy.md': '---\ntitle: 安全\n---\n\n请报告至 https://github.com/Tsubaki01/ambercast/security/advisories/new。\n',
      // The real handoff's changelog is historical material, so its 0.2.0 release label stays literal.
      'handoff/content/en/reference/changelog.md': '---\ntitle: Changelog\n---\n\n## Release 0.2.0 {#release-020}\n\nVersion 0.2.0 has one declared breaking change.\n',
      'handoff/content/ja/reference/changelog.md': '---\ntitle: 変更履歴\n---\n\n## 0.2.0 リリース {#release-020}\n\n0.2.0 は履歴上のリリースです。\n',
      'handoff/content/zh-cn/reference/changelog.md': '---\ntitle: 更新日志\n---\n\n## 0.2.0 版本 {#release-020}\n\n0.2.0 是历史版本。\n',
    };

    for (const page of plannedPages) {
      for (const locale of ['en', 'ja', 'zh-cn']) {
        files[sourcePath(locale, page)] = plannedSource(`${locale} ${page}`);
      }
    }

    // These are the six real A6b offenders found by comparing handoff fence sequences.
    for (const [index, page] of fencePages.entries()) {
      const canonical = [`canonical-${index}-one`, `canonical-${index}-two`];
      files[sourcePath('en', page)] = fenceSource(`en ${page}`, canonical);
      files[sourcePath('ja', page)] = fenceSource(`ja ${page}`, index % 2 === 0 ? [canonical[0], 'surplus-ja', canonical[1]] : [canonical[0]]);
      files[sourcePath('zh-cn', page)] = fenceSource(`zh ${page}`, index % 2 === 0 ? [canonical[1]] : [canonical[0], 'surplus-zh', canonical[1], 'surplus-zh-two']);
    }

    const fixture = createDocsFixture(files);
    fixtures.push(fixture);

    const result = runPlacement(fixture.root, `${fixture.root}/handoff`);

    expect(result.status).toBe(0);
    expect(fixture.read('docs/spec/overview.md')).toBe('# Overview\n\nThis specification describes ambercast 0.3.1 and 0.3.1.  [repo:src/core/ir/schema.ts:57]\n');
    expect(fixture.read(outputPath('', 'reference/security-policy'))).toBe('---\ntitle: Security\n---\n\nReport at https://github.com/kotarotsubaki/ambercast/security/advisories/new.\n');
    expect(fixture.read(outputPath('', 'reference/changelog'))).toContain('## Release 0.2.0 {#release-020}');
    expect(fixture.read(outputPath('', 'reference/changelog'))).toContain('Version 0.2.0 has one declared breaking change.');

    for (const locale of ['', 'ja', 'zh-cn']) {
      const roadmap = fixture.read(outputPath(locale, 'explanation/status-and-roadmap'));
      expect(roadmap).toContain('{#implemented}');
      expect(roadmap).not.toContain('{#implemented-in-0-2-0}');
      expect(roadmap).toContain('0.3.1');
      expect(fixture.read(outputPath(locale, 'reference/security-policy'))).not.toContain('Tsubaki01');
    }

    for (const page of plannedPages) {
      for (const locale of ['', 'ja', 'zh-cn']) {
        const sourceLocale = locale || 'en';
        expect(fixture.read(outputPath(locale, page))).toBe(expectedPlanned(`${sourceLocale} ${page}`));
      }
    }

    for (const page of fencePages) {
      const enFences = fencedBodies(fixture.read(outputPath('', page)));
      expect(enFences).toHaveLength(2);
      expect(fencedBodies(fixture.read(outputPath('ja', page)))).toEqual(enFences);
      expect(fencedBodies(fixture.read(outputPath('zh-cn', page)))).toEqual(enFences);
    }
  });

  it('is idempotent: a second run reproduces every output byte', () => {
    const fixture = createDocsFixture({
      'website/.fixture': '',
      'handoff/docs-spec/overview.md': '# Overview\n\nCurrent ambercast 0.2.0.\n',
      'handoff/content/en/agents/official-skill.md': plannedSource('Official skill'),
      'handoff/content/ja/agents/official-skill.md': plannedSource('公式スキル'),
      'handoff/content/zh-cn/agents/official-skill.md': plannedSource('官方 skill'),
    });
    fixtures.push(fixture);

    expect(runPlacement(fixture.root, `${fixture.root}/handoff`).status).toBe(0);
    const first = [
      fixture.read('docs/spec/overview.md'),
      fixture.read(outputPath('', 'agents/official-skill')),
      fixture.read(outputPath('ja', 'agents/official-skill')),
      fixture.read(outputPath('zh-cn', 'agents/official-skill')),
    ];

    expect(runPlacement(fixture.root, `${fixture.root}/handoff`).status).toBe(0);
    expect([
      fixture.read('docs/spec/overview.md'),
      fixture.read(outputPath('', 'agents/official-skill')),
      fixture.read(outputPath('ja', 'agents/official-skill')),
      fixture.read(outputPath('zh-cn', 'agents/official-skill')),
    ]).toEqual(first);
  });

  it('reports all absent handoff roots and performs no partial writes', () => {
    const fixture = createDocsFixture({
      'website/src/content/docs/existing.md': 'must remain byte-identical\n',
      'docs/spec/existing.md': 'must remain byte-identical\n',
    });
    fixtures.push(fixture);
    const before = [fixture.read('website/src/content/docs/existing.md'), fixture.read('docs/spec/existing.md')];

    const result = runPlacement(fixture.root, `${fixture.root}/missing-handoff`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n').sort()).toEqual([
      'Missing handoff directory: content',
      'Missing handoff directory: docs-spec',
    ]);
    expect([fixture.read('website/src/content/docs/existing.md'), fixture.read('docs/spec/existing.md')]).toEqual(before);
  });
});
