import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLI_MANIFEST, renderUsage } from '#core/cli/manifest.js';

function firstTextFence(markdown: string): string | undefined {
  const lines = markdown.split('\n');
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (start < 0 && /^```text\s*$/.test(lines[index]!)) start = index + 1;
    else if (start >= 0 && /^```\s*$/.test(lines[index]!)) return lines.slice(start, index).join('\n');
  }
  return undefined;
}

function usageMatches(markdown: string, usage: string): boolean {
  const block = firstTextFence(markdown);
  return block !== undefined && block.replace(/\n$/, '') === usage.replace(/\n$/, '');
}

describe('CLI overview usage fences', () => {
  it.each(['', 'ja/', 'zh-cn/'])('matches renderUsage for %s', (locale) => {
    const markdown = readFileSync(new URL(`../../../website/src/content/docs/${locale}reference/cli/overview.md`, import.meta.url), 'utf8');
    expect(usageMatches(markdown, renderUsage(CLI_MANIFEST))).toBe(true);
  });

  it('detects one changed character through the same extraction and comparison', () => {
    const usage = renderUsage(CLI_MANIFEST);
    const fixture = `# Usage\n\n\`\`\`text\n${usage.replace(/./, 'X')}\n\`\`\`\n`;
    expect(usageMatches(fixture, usage)).toBe(false);
  });
});
