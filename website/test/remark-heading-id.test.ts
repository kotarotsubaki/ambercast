import { describe, expect, it } from 'vitest';
import { visit } from 'unist-util-visit';
import { parseProseTree } from '../scripts/lib/prose-text.mjs';
import remarkHeadingId from '../scripts/lib/remark-heading-id.mjs';

describe('remarkHeadingId', () => {
  it.each([['md', '{#t1}'], ['mdx', '\\{#t1}']] as const)('sets the id on a Steps heading parsed from .%s content', (ext, anchor) => {
    const tree = parseProseTree(`<Steps>\n\n1. ## T ${anchor}\n\n</Steps>\n`, { isMdx: ext === 'mdx' });
    remarkHeadingId()(tree);
    let heading;
    visit(tree, 'heading', (node) => { heading ??= node; });
    expect(heading?.data?.hProperties?.id).toBe('t1');
  });
});
