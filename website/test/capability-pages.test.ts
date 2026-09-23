import { describe, expect, it } from 'vitest';
import { plannedPageSlugs } from '../scripts/lib/capability-pages.mjs';
import mapping from '../src/data/capability-pages.json';

describe('plannedPageSlugs', () => {
  it('returns the sorted six-page union, deduplicating the shared baseline/restore page', () => {
    expect(plannedPageSlugs(mapping)).toEqual([
      'agents/mcp-server',
      'agents/official-skill',
      'reference/cli/baseline-restore',
      'reference/cli/mcp',
      'reference/cli/review',
      'reference/mcp-tools',
    ]);
  });

  it('deduplicates repeated values within one capability as well as across capabilities', () => {
    expect(plannedPageSlugs({ capabilities: { a: ['z', 'z'], b: ['z', 'a'] }, unlisted: { a: {} } })).toEqual(['a', 'z']);
  });
});
