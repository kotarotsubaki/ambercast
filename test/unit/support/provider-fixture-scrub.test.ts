import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadCorpus } from '../../support/corpus.js';
import { findCredentialLiterals, ProviderFixtureValue, scanProviderOutputCorpus } from '../../support/provider-fixture.js';

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  readFileSync: vi.fn((...args: Parameters<typeof readFileSync>) => originalRead(...args)),
}));
const { readFileSync: originalRead } = await vi.importActual<typeof import('node:fs')>('node:fs');
const dirs: string[] = [];

/** Isolated directories keep malformed scrub inputs outside the committed corpus. */
function directory(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'provider-scrub-')));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.mocked(readFileSync).mockClear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sk = 'sk-abcdef1234567890';
const jwt = 'eyJabcdefghijk.abcdefghijkl.abcdefgh1234';
const bearer = 'Bearer abcdef1234567890abcdef';
const positive = [
  { note: 'sk prefix', text: sk, detector: 'credential-prefix-sk', offset: 0 },
  { note: 'ghp prefix', text: `ghp_${'a'.repeat(36)}`, detector: 'credential-prefix-ghp', offset: 0 },
  { note: 'AWS access key prefix', text: 'AKIA1234567890ABCDEF', detector: 'credential-prefix-aws-access-key', offset: 0 },
  { note: 'PGP private key', text: '-----BEGIN PGP PRIVATE KEY BLOCK-----', detector: 'private-key-block', offset: 0 },
  { note: 'RSA private key', text: '-----BEGIN RSA PRIVATE KEY-----', detector: 'private-key-block', offset: 0 },
  { note: 'JWT', text: jwt, detector: 'jwt', offset: 0 },
  { note: 'GitHub OAuth token', text: `gho_${'a'.repeat(36)}`, detector: 'github-token', offset: 0 },
  { note: 'GitHub fine-grained token', text: `github_pat_${'a'.repeat(24)}`, detector: 'github-token', offset: 0 },
  { note: 'Slack token', text: 'xoxb-1234567890-abcdef', detector: 'slack-token', offset: 0 },
  { note: 'Bearer with a digit', text: bearer, detector: 'bearer-token', offset: 0 },
  { note: 'adjacent JSON escape', text: String.raw`\nsk-abcdef12345`, detector: 'credential-prefix-sk', offset: 2 },
  { note: 'Claude double layer', text: JSON.stringify({ result: JSON.stringify({ token: String.raw`\nsk-abcdef1234567890` }) }), detector: 'credential-prefix-sk', offset: 2 },
];

describe('credential scrub', () => {
  it.each([3, 4])('TEST-18 credential requiring %i decode layers respects the depth ceiling', depth => {
    // Encoding the prefix prevents raw-string scanning from detecting it early.
    let text = String.raw`"\u0073k-abcdef1234567890"`;
    for (let layer = 1; layer < depth; layer++) text = JSON.stringify(text);
    const expected = depth === 3 ? [{ detector: 'credential-prefix-sk', offset: 0 }] : [];
    expect(findCredentialLiterals(text)).toStrictEqual(expected);
    const dir = directory();
    writeFileSync(join(dir, 'depth.jsonl'), `${JSON.stringify({ value: { stdout: text } })}\n`);
    expect(scanProviderOutputCorpus(dir)).toStrictEqual(depth === 3 ? [
      { file: 'depth.jsonl', line: 1, path: 'value.stdout~1~2~3', layer: 3, detector: 'credential-prefix-sk', offset: 0 },
    ] : []);
  });
  it.each(positive)('TEST-18 detects $note without exposing its value', ({ text, detector, offset }) => {
    const findings = findCredentialLiterals(text);
    expect(findings).toContainEqual({ detector, offset });
    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toStrictEqual(['detector', 'offset']);
      expect(finding.offset).toBeGreaterThanOrEqual(0);
    }
    expect(JSON.stringify(findings)).not.toContain(text);
  });

  it.each([
    '-----BEGIN CERTIFICATE-----', 'eyJhbGci.short.x', 'ghost_users_table_long_name_value',
    'xox-short', 'Bearer authentication-flow-overview-text',
    'complete-sign-in-flow-and-verify-dashboard-reached',
    'export-2026-quarterly-xlsx-bundle-jpg-pdf-zip', 'a'.repeat(40),
    '550e8400-e29b-41d4-a716-446655440000', 'task-123', 'desk-lamp', '{{secrets.password}}', '',
  ])('TEST-18 accepts noncredential %j', text => {
    expect(findCredentialLiterals(text)).toStrictEqual([]);
  });

  it.each(positive.filter(entry => ['private-key-block', 'jwt', 'github-token', 'slack-token', 'bearer-token'].includes(entry.detector)))('TEST-18 returns both occurrences of $note', ({ text, detector }) => {
    const input = `prefix ${text} separator ${text}`;
    expect(findCredentialLiterals(input).filter(finding => finding.detector === detector)).toStrictEqual([
      { detector, offset: 7 }, { detector, offset: 7 + text.length + ' separator '.length },
    ]);
  });

  it.each(['path', 'url'])('TEST-18 scans strings, decoded layers, redacted descendants, and malformed rows via %s', reference => {
    const dir = directory();
    mkdirSync(join(dir, 'nested'));
    const row = { value: {
      stdout: JSON.stringify(sk), stderr: jwt,
      wrapped: JSON.stringify({ result: JSON.stringify({ token: sk }) }),
      nested: { [sk]: { child: jwt, [bearer]: [sk] } },
      'duplicate.path': sk, duplicate: { path: sk },
      'same~1': sk, same: JSON.stringify(sk),
    }, note: bearer };
    writeFileSync(join(dir, 'nested', 'b.jsonl'), `${JSON.stringify(row)}\n\n{broken\n${JSON.stringify({ value: { nested: { [sk]: 'safe' } } })}\n`);
    writeFileSync(join(dir, 'a.jsonl'), `${JSON.stringify({ note: sk })}\n`);
    writeFileSync(join(dir, 'ignored.txt'), sk);
    const findings = scanProviderOutputCorpus(reference === 'url' ? new URL(`file://${dir}/`) : dir);
    expect(findings).toContainEqual({ file: 'a.jsonl', line: 1, path: 'note', layer: 0, detector: 'credential-prefix-sk', offset: 0 });
    expect(findings).toContainEqual({ file: 'nested/b.jsonl', line: 1, path: 'value.stdout~1', layer: 1, detector: 'credential-prefix-sk', offset: 0 });
    expect(findings).toContainEqual({ file: 'nested/b.jsonl', line: 1, path: 'value.stderr', layer: 0, detector: 'jwt', offset: 0 });
    expect(findings).toContainEqual({ file: 'nested/b.jsonl', line: 1, path: 'note', layer: 0, detector: 'bearer-token', offset: 0 });
    expect(findings).toContainEqual({ file: 'nested/b.jsonl', line: 1, path: 'value.wrapped~1.result~2.token', layer: 2, detector: 'credential-prefix-sk', offset: 0 });
    // Colliding rendered paths exercise deduplication rather than merely checking uniqueness.
    expect(findings.filter(finding => finding.path === 'value.duplicate.path')).toStrictEqual([
      { file: 'nested/b.jsonl', line: 1, path: 'value.duplicate.path', layer: 0, detector: 'credential-prefix-sk', offset: 0 },
    ]);
    expect(findings.filter(finding => finding.path === 'value.same~1')).toStrictEqual([
      { file: 'nested/b.jsonl', line: 1, path: 'value.same~1', layer: 0, detector: 'credential-prefix-sk', offset: 0 },
      { file: 'nested/b.jsonl', line: 1, path: 'value.same~1', layer: 1, detector: 'credential-prefix-sk', offset: 0 },
    ]);
    const redacted = findings.filter(finding => finding.line === 1 && finding.path.includes('[redacted-key#'));
    expect(redacted).toHaveLength(4);
    expect(redacted).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'value.nested[redacted-key#1]', detector: 'credential-prefix-sk', layer: 0, offset: 0 }),
      expect.objectContaining({ path: 'value.nested[redacted-key#1].child', detector: 'jwt', layer: 0, offset: 0 }),
      expect.objectContaining({ path: 'value.nested[redacted-key#1][redacted-key#2]', detector: 'bearer-token', layer: 0, offset: 0 }),
      expect.objectContaining({ path: 'value.nested[redacted-key#1][redacted-key#2][0]', detector: 'credential-prefix-sk', layer: 0, offset: 0 }),
    ]));
    expect(findings.filter(finding => finding.line === 4)).toStrictEqual([
      { file: 'nested/b.jsonl', line: 4, path: 'value.nested[redacted-key#1]', layer: 0, detector: 'credential-prefix-sk', offset: 0 },
    ]);
    expect(findings.filter(finding => finding.detector === 'unparseable-line')).toStrictEqual([
      { file: 'nested/b.jsonl', line: 2, path: '', layer: 0, detector: 'unparseable-line', offset: 0 },
      { file: 'nested/b.jsonl', line: 3, path: '', layer: 0, detector: 'unparseable-line', offset: 0 },
    ]);
    const identities = findings.map(f => JSON.stringify([f.file, f.line, f.path, f.layer, f.offset, f.detector]));
    expect(new Set(identities).size).toBe(findings.length);
    // The presentation order deliberately excludes layer, unlike the identity.
    const ordered = [...findings].sort((a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.offset - b.offset ||
      (a.detector < b.detector ? -1 : a.detector > b.detector ? 1 : 0));
    expect(findings).toStrictEqual(ordered);
    for (const secret of [sk, jwt, bearer]) expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it('TEST-18 fails closed when a listed JSONL file cannot be read', () => {
    const dir = directory();
    writeFileSync(join(dir, 'unreadable.jsonl'), '{}\n');
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error('scrub read failed'); });
    expect(() => scanProviderOutputCorpus(dir)).toThrow('scrub read failed');
  });

  it('TEST-19 scans a nonempty committed corpus and double-loads every JSONL', () => {
    const dir = new URL('../../fixtures/corpus/provider-output/', import.meta.url);
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(scanProviderOutputCorpus(dir)).toStrictEqual([]);
    for (const entry of files) {
      const file = join(entry.parentPath, entry.name);
      const schemas = { value: ProviderFixtureValue, expected: z.unknown() };
      const first = loadCorpus(file, schemas);
      expect(first.length).toBeGreaterThan(0);
      expect(loadCorpus(file, schemas)).toStrictEqual(first);
    }
  });
});
