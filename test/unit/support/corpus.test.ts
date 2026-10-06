import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadCorpus } from '../../support/corpus.js';

const schemas = { value: z.string(), expected: z.string() };
const directories: string[] = [];
const row = (value: unknown, changes: Record<string, unknown> = {}) => JSON.stringify({
  value, expected: 'ok', note: 'case', source: '#547', date: '2026-10-06', ...changes,
});

function temporaryFile(contents: string | Uint8Array): string {
  const directory = mkdtempSync(join(tmpdir(), 'ambercast-corpus-'));
  directories.push(directory);
  const file = join(directory, 'cases.jsonl');
  writeFileSync(file, contents);
  return file;
}

function problems(file: string, expected: Array<{ location: string; reason: RegExp }>, usedSchemas: { value: z.ZodType; expected: z.ZodType } = schemas): void {
  try {
    loadCorpus(file, usedSchemas);
    throw new Error('loadCorpus returned without reporting corpus problems');
  } catch (error) {
    const message = (error as Error).message;
    expect(message).not.toBe('loadCorpus returned without reporting corpus problems');
    expect(message).toContain(file);
    expect(message.split('\n')[0]).toBe(`loadCorpus: ${file}: ${expected.length} problem(s)`);
    let previous = message.indexOf('\n');
    for (const { location, reason } of expected) {
      const next = message.indexOf(location, previous + 1);
      expect(next).toBeGreaterThan(previous);
      const line = message.slice(next, message.indexOf('\n', next) < 0 ? undefined : message.indexOf('\n', next));
      expect(line).toMatch(reason);
      previous = next;
    }
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('loadCorpus (TEST-A10, SPEC-A8)', () => {
  it('returns three rows in file order with original line numbers and both schema transforms', () => {
    const file = temporaryFile(`${row('first')}\r\n${row('second')}\n${row('third')}`);
    const transformed = loadCorpus(file, {
      value: z.string().transform((value) => value.toUpperCase()),
      expected: z.string().transform((value) => `${value}!`),
    });
    expect(transformed).toEqual([
      { value: 'FIRST', expected: 'ok!', note: 'case', source: '#547', date: '2026-10-06', line: 1 },
      { value: 'SECOND', expected: 'ok!', note: 'case', source: '#547', date: '2026-10-06', line: 2 },
      { value: 'THIRD', expected: 'ok!', note: 'case', source: '#547', date: '2026-10-06', line: 3 },
    ]);
  });

  it.each([
    ['missing file', () => join(tmpdir(), `ambercast-corpus-missing-${process.pid}.jsonl`), /cannot read.*ENOENT/],
    ['directory', () => { const file = temporaryFile(''); return join(file, '..'); }, /cannot read.*EISDIR/],
  ])('1: reports an unreadable %s as one file problem', (_name, makePath, reason) => {
    problems(makePath(), [{ location: 'file', reason }]);
  });

  it('2: rejects invalid UTF-8 before row inspection', () => {
    problems(temporaryFile(Buffer.from([0x7b, 0xff, 0x7d])), [{ location: 'file', reason: /UTF-8/i }]);
  });

  it('3: rejects a UTF-8 BOM', () => {
    problems(temporaryFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(row('a'))])), [
      { location: 'file', reason: /BOM/i },
    ]);
  });

  it.each(['', ' \n\t\r\n '])('4: reports zero entries once at file level (%j)', (content) => {
    problems(temporaryFile(content), [{ location: 'file', reason: /empty|no (rows|entries)/i }]);
  });

  it.each([
    [5, ' \r\n' + row('valid'), /blank|empty/i],
    [6, '{bad\n' + row('valid'), /JSON/i],
    [7, '[]\n' + row('valid'), /object/i],
    [8, JSON.stringify({ value: 'a', expected: 'ok', note: 'case', source: '#547' }) + '\n' + row('valid'), /missing.*date/i],
    [9, row('a', { extra: true }) + '\n' + row('valid'), /extra|unexpected/i],
    [10, row(3) + '\n' + row('valid'), /value schema/i],
    [11, row('a', { expected: 3 }) + '\n' + row('valid'), /expected schema/i],
    [12, row('a', { note: '  ' }) + '\n' + row('valid'), /note/i],
    [13, row('a', { source: '#01' }) + '\n' + row('valid'), /source/i],
    [14, row('a', { date: '2026-1-06' }) + '\n' + row('valid'), /date/i],
    [15, row('a', { date: '2026-02-30' }) + '\n' + row('valid'), /date/i],
    [15, row('a', { date: '2026-13-45' }) + '\n' + row('valid'), /valid calendar date/i],
    [16, row('a') + '\n' + row('a'), /duplicates value of line 1/],
  ] as const)('%i: reports the first row violation and continues', (_number, content, reason) => {
    const location = _number === 16 ? 'line 2' : 'line 1';
    problems(temporaryFile(content), [{ location, reason }]);
  });

  it('reports a throwing value schema on its row and inspects the next row', () => {
    const file = temporaryFile(`${row('throw')}\n${row('also-bad', { note: '' })}`);
    const throwing = { value: z.string().transform((value) => {
      if (value === 'throw') throw new Error('boom');
      return value;
    }), expected: z.string() };
    problems(file, [
      { location: 'line 1', reason: /value schema threw: boom/ },
      { location: 'line 2', reason: /note/i },
    ], throwing);
  });

  it('reports condition 12 before duplicate condition 16 on one row', () => {
    const file = temporaryFile(`${row('same')}\n${row('same', { note: '' })}`);
    problems(file, [{ location: 'line 2', reason: /note/i }]);
    try {
      loadCorpus(file, schemas);
    } catch (error) {
      expect((error as Error).message).not.toContain('duplicates value');
    }
  });

  it('excludes an invalid first row from duplicate tracking', () => {
    const file = temporaryFile(`${row('same', { note: '' })}\n${row('same')}\n${row('same')}`);
    problems(file, [
      { location: 'line 1', reason: /note/i },
      { location: 'line 3', reason: /duplicates value of line 2/ },
    ]);
  });

  it('reports one problem for each of two bad rows', () => {
    const file = temporaryFile(`${row('a', { source: '#0' })}\n${row('b', { date: '2026-02-30' })}`);
    problems(file, [
      { location: 'line 1', reason: /source/i },
      { location: 'line 2', reason: /date/i },
    ]);
  });

  it.each([
    ['relative path', 'relative.jsonl'],
    ['https URL', new URL('https://example.com/cases.jsonl')],
  ])('rejects a %s as invalid input', (_name, file) => {
    expect(() => loadCorpus(file, schemas)).toThrow(/^loadCorpus: invalid input:/);
  });

  it.each(loadCorpus(new URL('../../fixtures/corpus/examples/strings.jsonl', import.meta.url), schemas))('line $line: $note', (entry) => {
    expect(entry.expected).toBe(entry.value.toUpperCase());
    expect(entry.source).toMatch(/^#[1-9][0-9]*$/);
    expect(Number.isNaN(Date.parse(entry.date))).toBe(false);
  });
});

describe('loadCorpus invalid inputs (TEST-A12, SPEC-A11)', () => {
  it.each([
    ['missing schemas argument', undefined],
    ['missing value schema', { expected: z.string() }],
    ['missing expected schema', { value: z.string() }],
    ['empty schemas', {}],
  ])('rejects %s with its own Error', (_name, invalidSchemas) => {
    const file = temporaryFile(row('a'));
    try {
      loadCorpus(file, invalidSchemas as never);
      throw new Error('loadCorpus accepted invalid schemas');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toMatch(/^loadCorpus: invalid input:/);
    }
  });

  it('rejects a file URL whose host makes fileURLToPath throw', () => {
    try {
      loadCorpus(new URL('file://remote-host/x.jsonl'), schemas);
      throw new Error('loadCorpus accepted a remote file URL');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toMatch(/^loadCorpus: invalid input:/);
    }
  });
});
