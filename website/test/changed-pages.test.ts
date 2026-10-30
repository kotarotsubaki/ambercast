import { describe, expect, it } from 'vitest';
import { variantForPath, selectChanges, newViolations } from '../scripts/lib/changed-pages.mjs';

const doc = (slug: string, locale = 'en', ext = 'md') => `website/src/content/docs/${locale === 'en' ? '' : `${locale}/`}${slug}.${ext}`;
const variant = (slug: string, locale = 'en') => ({ slug, locale });
const entries = (map: Map<string, unknown>) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b));

describe('variantForPath', () => {
  it.each([
    ...['en', 'ja', 'zh-cn'].flatMap((locale) => ['md', 'mdx'].map((ext) => [doc('reference/x', locale, ext), variant('reference/x', locale)])),
    ...['introduction', 'philosophy', 'how-it-works', 'tutorials/x', 'how-to/x', 'explanation/x', 'agents/x'].map((slug) => [doc(slug), variant(slug)]),
    ['docs/spec/chapter.md', variant('spec/chapter')],
    ['docs/spec/nested/chapter.mdx', variant('spec/chapter')],
    [doc('spec/chapter', 'ja'), variant('spec/chapter', 'ja')],
    ...[doc('spec/chapter'), doc('preview-blocks', 'en', 'mdx'), doc('assets/image'), doc('unknown/x'), doc('nested/unknown/x'), doc('reference/Upper'), doc('reference/a_b'), doc('reference//x'), doc('reference/x', 'en', 'txt'), 'assets/x.md', 'docs/other/x.md', 'docs/spec/image.svg'].map((source) => [source, null]),
  ])('%s maps to its source variant or is ignored', (source, expected) => {
    expect(variantForPath(source)).toEqual(expected);
  });
});

describe('selectChanges', () => {
  it.each(['A', 'M', 'D', 'T'])('%s selects a candidate without overriding its baseline', (status) => {
    const result = selectChanges([{ status, path: doc('reference/x') }]);
    expect(result.candidates).toEqual(['reference/x']);
    expect(entries(result.predecessor)).toEqual([]);
  });

  const cases = [
    { name: 'one locale moves and both endpoints remain candidates', changes: [{ status: 'R100', from: doc('reference/old', 'ja'), path: doc('reference/new', 'ja') }], candidates: ['reference/new', 'reference/old'], overrides: [['reference/new\0ja', variant('reference/old', 'ja')]] },
    { name: 'existing destination translations keep their own baseline', changes: [{ status: 'M', path: doc('reference/new', 'en') }, { status: 'R90', from: doc('reference/old', 'ja'), path: doc('reference/new', 'ja') }, { status: 'M', path: doc('reference/new', 'zh-cn') }], candidates: ['reference/new', 'reference/old'], overrides: [['reference/new\0ja', variant('reference/old', 'ja')]] },
    { name: 'two locales have different predecessors', changes: [{ status: 'R100', from: doc('reference/a', 'ja'), path: doc('reference/new', 'ja') }, { status: 'R80', from: doc('reference/b', 'zh-cn'), path: doc('reference/new', 'zh-cn') }], candidates: ['reference/a', 'reference/b', 'reference/new'], overrides: [['reference/new\0ja', variant('reference/a', 'ja')], ['reference/new\0zh-cn', variant('reference/b', 'zh-cn')]] },
    { name: 'doc to non-doc is a deletion', changes: [{ status: 'R100', from: doc('reference/a'), path: 'notes/a.md' }], candidates: ['reference/a'], overrides: [] },
    { name: 'non-doc to doc is an addition', changes: [{ status: 'R100', from: 'notes/a.md', path: doc('reference/a') }], candidates: ['reference/a'], overrides: [] },
    { name: 'copy selects only destination with its own baseline', changes: [{ status: 'C100', from: doc('reference/a'), path: doc('reference/b') }], candidates: ['reference/b'], overrides: [] },
    { name: 'duplicates collapse and candidates sort', changes: [{ status: 'M', path: doc('reference/z') }, { status: 'A', path: doc('reference/a') }, { status: 'M', path: doc('reference/z', 'ja') }, { status: 'M', path: 'README.md' }], candidates: ['reference/a', 'reference/z'], overrides: [] },
    { name: 'md wins over mdx collision by destination then source', changes: [{ status: 'R100', from: doc('reference/z'), path: doc('reference/new', 'en', 'mdx') }, { status: 'R100', from: doc('reference/b'), path: doc('reference/new') }, { status: 'R100', from: doc('reference/a'), path: doc('reference/new') }], candidates: ['reference/a', 'reference/b', 'reference/new', 'reference/z'], overrides: [['reference/new\0en', variant('reference/a')]] },
    { name: 'cross-locale rename preserves source locale', changes: [{ status: 'R100', from: doc('reference/a', 'ja'), path: doc('reference/b', 'zh-cn') }], candidates: ['reference/a', 'reference/b'], overrides: [['reference/b\0zh-cn', variant('reference/a', 'ja')]] },
  ];
  it.each(cases)('$name, independent of input order', ({ changes, candidates, overrides }) => {
    for (const records of [changes, [...changes].reverse()]) {
      const result = selectChanges(records);
      expect(result.candidates).toEqual(candidates);
      expect(entries(result.predecessor)).toEqual(overrides);
    }
  });
  it.each([
    [{ status: 'Q', path: doc('reference/a') }],
    [{ status: 'R100', path: doc('reference/a') }],
    [{ status: 'C90', path: doc('reference/a') }],
  ])('rejects malformed parsed records: %j', (change) => {
    expect(() => selectChanges([change])).toThrow();
  });
  it('handles an empty change list', () => {
    const result = selectChanges([]);
    expect(result.candidates).toEqual([]);
    expect(entries(result.predecessor)).toEqual([]);
  });
});

const finding = (overrides: Record<string, unknown> = {}) => ({ check: 'prose', page: 'reference/x', locale: 'en', rule: 'sentence-length', severity: 'error', expected: '<= 30', actual: '31', line: 1, ...overrides });
describe('newViolations', () => {
  it.each([
    { name: 'empty base preserves all head findings', head: [finding(), finding({ line: 9 })], base: [], expected: [finding(), finding({ line: 9 })] },
    { name: 'shifted lines and renamed pages cancel', head: [finding({ line: 99, page: 'reference/new' })], base: [finding()], expected: [] },
    { name: 'surplus head duplicates are the later occurrences', head: [finding({ line: 2 }), finding({ line: 5 }), finding({ line: 8 })], base: [finding(), finding({ line: 10 })], expected: [finding({ line: 8 })] },
    { name: 'surplus base duplicates do not create findings', head: [finding()], base: [finding(), finding()], expected: [] },
    ...['locale', 'rule', 'severity', 'expected', 'actual'].map((key) => ({ name: `changed ${key} is new`, head: [finding({ [key]: key === 'severity' ? 'warning' : 'changed' })], base: [finding()], expected: [finding({ [key]: key === 'severity' ? 'warning' : 'changed' })] })),
    { name: 'warnings and errors cancel separately while head order remains', head: [finding({ severity: 'warning', line: 7 }), finding({ line: 3 }), finding({ severity: 'warning', line: 9 }), finding({ actual: '40', line: 4 })], base: [finding({ severity: 'warning' }), finding()], expected: [finding({ severity: 'warning', line: 9 }), finding({ actual: '40', line: 4 })] },
    { name: 'empty head stays empty', head: [], base: [finding()], expected: [] },
  ])('$name', ({ head, base, expected }) => {
    const before = structuredClone({ head, base });
    expect(newViolations(head, base)).toEqual(expected);
    expect({ head, base }).toEqual(before);
  });
});
