import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadCorpus } from '../../support/corpus.js';
import { ProviderFixtureValue } from '../../support/provider-fixture.js';

const seed = new URL('../../fixtures/corpus/provider-output/live-request-schema.jsonl', import.meta.url);
const expected = z.strictObject({ steps: z.array(z.strictObject({ kind: z.string(), verificationIntent: z.array(z.unknown()) })) });
const dirs: string[] = [];

/** Fresh raw input keeps each rejection attributable to exactly one rule. */
function fixture() {
  return {
    provider: 'codex-cli',
    provenance: { ambercast: '0ea560b', input: 'Schema test.', origin: 'synthetic' } as Record<string, unknown>,
    run: { exitCode: 0 },
  } as Record<string, unknown> & { provenance: Record<string, unknown> };
}

/** Real paths avoid platform temp-directory aliases in loader diagnostics. */
function corpus(values: unknown[]): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'provider-schema-')));
  dirs.push(dir);
  const file = join(dir, 'rows.jsonl');
  writeFileSync(file, values.map(value => JSON.stringify({ value, expected: {}, note: 'Schema boundary.', source: '#546', date: '2026-10-10' })).join('\n') + '\n');
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Rejection = { note: string; mutate: (f: ReturnType<typeof fixture>) => void; key?: string; message?: string };
const rejections: Rejection[] = [
  { note: 'missing provenance', mutate: f => { Reflect.deleteProperty(f, 'provenance'); }, key: 'provenance' },
  ...['ambercast', 'input', 'origin'].map(key => ({ note: `missing ${key}`, mutate: (f: ReturnType<typeof fixture>) => { delete f.provenance[key]; }, key })),
  ...['v0.9', 'abcdef', 'a'.repeat(41), 'ABCDEF1'].map(ref => ({ note: `invalid ambercast ${ref}`, mutate: (f: ReturnType<typeof fixture>) => { f.provenance.ambercast = ref; }, key: 'ambercast' })),
  { note: 'blank input', mutate: f => { f.provenance.input = '   '; }, key: 'input' },
  { note: 'unknown origin', mutate: f => { f.provenance.origin = 'copied'; }, key: 'origin' },
  ...[undefined, '   '].map(note => ({ note: `reconstructed note ${String(note)}`, mutate: (f: ReturnType<typeof fixture>) => { f.provenance.origin = 'reconstructed'; if (note !== undefined) f.provenance.note = note; }, message: 'reconstructed provenance requires note' })),
  { note: 'recorded without version', mutate: f => { f.provenance.origin = 'recorded'; }, message: 'recorded provenance requires providerVersion' },
  ...['synthetic', 'reconstructed', 'recorded'].flatMap(origin => ['', '   '].map(version => ({ note: `${origin} blank providerVersion ${JSON.stringify(version)}`, mutate: (f: ReturnType<typeof fixture>) => { Object.assign(f.provenance, { origin, note: 'Recreated.', providerVersion: version }); }, key: 'providerVersion' }))),
  { note: 'extra value key', mutate: f => { f.extra = true; }, key: 'extra' },
  { note: 'unknown provider', mutate: f => { f.provider = 'other'; }, key: 'provider' },
  ...['payload', ''].map(outputFile => ({ note: `claude outputFile ${JSON.stringify(outputFile)}`, mutate: (f: ReturnType<typeof fixture>) => { Object.assign(f, { provider: 'claude-code-cli', outputFile }); }, message: 'outputFile is codex-cli only' })),
  { note: 'missing run', mutate: f => { delete f.run; }, key: 'run' },
  ...[256, -1, 1.5].map(exitCode => ({ note: `exitCode ${exitCode}`, mutate: (f: ReturnType<typeof fixture>) => { f.run = { exitCode }; }, key: 'run' })),
  { note: 'exitCode and signal', mutate: f => { f.run = { exitCode: 0, signal: 'SIGTERM' }; }, key: 'run' },
  ...[{ delayMs: 5 }, { stdout: 'x' }, { stderr: 'x' }, { outputFile: 'payload' }, { outputFile: '' }].map(payload => ({ note: `hang with ${JSON.stringify(payload)}`, mutate: (f: ReturnType<typeof fixture>) => { Object.assign(f, { run: { hang: true } }, payload); }, message: 'hang fixture carries no payload or delay' })),
  ...[-1, 30001].map(delayMs => ({ note: `delayMs ${delayMs}`, mutate: (f: ReturnType<typeof fixture>) => { f.delayMs = delayMs; }, key: 'delayMs' })),
];

describe('provider fixture schema', () => {
  it.each(loadCorpus(seed, { value: ProviderFixtureValue, expected }))('TEST-1 line $line: $note', row => {
    const rows = loadCorpus(seed, { value: ProviderFixtureValue, expected });
    const provider = row.value.provider;
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.value.provider).sort()).toStrictEqual(['claude-code-cli', 'codex-cli']);
    const matching = rows.filter(row => row.value.provider === provider);
    expect(matching).toHaveLength(1);
    expect(row.value.provenance).toStrictEqual({ ambercast: '0ea560b', input: 'GeneratedPlanResponseRequest schema; ai step with verificationIntent: []', origin: 'synthetic' });
    expect(row.source).toBe('#546');
    expect(row.date).toBe('2026-10-10');
    expect(row.expected).toStrictEqual({ steps: [{ kind: 'ai', verificationIntent: [] }] });
    if (provider === 'codex-cli') expect(row.value.outputFile).toBeTypeOf('string');
    else {
      expect(row.value.stdout).toBeTypeOf('string');
      expect(row.value.outputFile).toBeUndefined();
    }
    expect(loadCorpus(seed, { value: ProviderFixtureValue, expected })).toStrictEqual(rows);
  });

  it.each(rejections)('TEST-2 rejects $note through the corpus loader', ({ mutate, key, message }) => {
    const invalid = fixture();
    mutate(invalid);
    const file = corpus([invalid]);
    let failure: unknown;
    try { loadCorpus(file, { value: ProviderFixtureValue, expected: z.unknown() }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const text = (failure as Error).message;
    expect(text).toMatch(/- line 1: value schema threw: /);
    if (key) {
      expect(text).toMatch(/"path"/);
      expect(text).toContain(`"${key}"`);
    }
    if (message) expect(text).toContain(message);
  });

  it.each([0, 1])('TEST-2 returns no partial result with an invalid row at index %i', index => {
    const invalid = fixture();
    delete invalid.run;
    const values = [fixture()];
    values.splice(index, 0, invalid);
    expect(() => loadCorpus(corpus(values), { value: ProviderFixtureValue, expected: z.unknown() })).toThrow(`- line ${index + 1}: value schema threw: `);
  });

  it.each([
    { note: 'synthetic defaults', patch: {} },
    { note: 'claude defaults', patch: { provider: 'claude-code-cli' } },
    ...['0ea560b', 'a'.repeat(40), '0.9.0', '1.0.0-rc.1'].map(ambercast => ({ note: `ref ${ambercast}`, patch: { provenance: { ...fixture().provenance, ambercast } } })),
    { note: 'reconstructed with note', patch: { provenance: { ...fixture().provenance, origin: 'reconstructed', note: 'Recreated response.' } } },
    { note: 'recorded with version', patch: { provenance: { ...fixture().provenance, origin: 'recorded', providerVersion: '1.0.0' } } },
    { note: 'exitCode upper boundary', patch: { run: { exitCode: 255 } } },
    ...['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'].map(signal => ({ note: `signal ${signal}`, patch: { run: { signal } } })),
    { note: 'hang defaults', patch: { run: { hang: true } } },
    { note: 'hang explicit defaults', patch: { run: { hang: true }, delayMs: 0, stdout: '', stderr: '' } },
    { note: 'delay upper boundary', patch: { delayMs: 30000 } },
    { note: 'empty codex file', patch: { outputFile: '' } },
  ])('TEST-3 accepts $note and preserves defaults and file absence', ({ patch }) => {
    const raw = { ...fixture(), ...patch };
    const parsed = ProviderFixtureValue.parse(raw);
    expect(parsed.stdout).toBe('');
    expect(parsed.stderr).toBe('');
    expect(parsed.delayMs).toBe('delayMs' in patch ? patch.delayMs : 0);
    expect(parsed.outputFile).toBe('outputFile' in patch ? '' : undefined);
    expect(parsed).toMatchObject(raw);
  });
});
