import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ZodType } from 'zod';

/** One validated corpus row, together with its original one-based source line number. */
export type CorpusEntry<V, E> = { value: V; expected: E; note: string; source: string; date: string; line: number };

/** Shared formatter for one corpus row problem; see `loadCorpus`'s remarks for the rendering rationale. */
function pushProblem(allProblems: string[], lineNum: number, reason: string): void {
  const normalizedReason = reason.replace(/\n/g, '\n  ');
  allProblems.push(`- line ${lineNum}: ${normalizedReason}`);
}

/**
 * Reads and validates a JSON Lines corpus synchronously, for use with `it.each`.
 *
 * @param file - A `file:` URL or an absolute filesystem path to the corpus; any other
 *   form of reference is rejected before the file is touched.
 * @param schemas - Caller-owned schemas that validate each row's `value` and
 *   `expected` fields; a `schemas` object missing either schema is rejected the same way.
 * @returns Validated entries in file order, each carrying its schema-parsed `value`
 *   and `expected` plus its original line number.
 * @throws An invalid-input error, named with this function's own name, for an
 *   unsupported file reference or a malformed `schemas` argument; otherwise an error
 *   collecting every file-level or row-level violation found, never a partial result.
 * @remarks
 * Loading is synchronous because Vitest collects `it.each` cases while test files are
 * being defined, before any asynchronous work could run. Resolve a `file:` URL to a
 * path and read the file's raw bytes before decoding them as UTF-8.
 *
 * File-level problems take precedence over row-level ones and stop row inspection
 * entirely, because a file that cannot be read correctly has no trustworthy rows to
 * report on: in order, an unreadable path, bytes that are not valid UTF-8, a UTF-8
 * byte-order mark, and finally an empty corpus (no rows at all, whether from an empty
 * file or from blank/whitespace-only lines, which are not reported individually when
 * this is the only problem).
 *
 * Once the file itself is readable, inspect every row and keep going even when a row
 * fails, so one bad row never hides a problem in another. Each row keeps only its
 * first applicable problem, in this fixed precedence: a blank line (after removing one
 * trailing carriage return, and never counting the empty trailing element a final
 * newline would otherwise produce); invalid JSON; a JSON value that is not a plain
 * object; a missing required key; an unexpected extra key; a `value` that fails its
 * caller-supplied schema, including when that schema throws instead of returning a
 * failure; an `expected` that fails the same way; a `note` that is not a nonblank
 * string; a `source` that does not match a `#` followed by one or more digits with
 * no leading zero (so `#0` and `#01` both fail, while `#1` and `#540` pass); a
 * `date` that is not `YYYY-MM-DD`; a `date` that is calendar-invalid even though it
 * matches that form (verified by round-tripping it through `Date`); and finally a
 * duplicate `value`, compared with `JSON.stringify` on the row's raw parsed value so
 * that key order matters. Only a row with no other problem can become the earlier
 * side of a duplicate comparison — a row already rejected for some other reason must
 * not suppress a genuine duplicate finding against a still-earlier good row.
 *
 * Each problem occupies one `- `-prefixed physical line, matching file-level
 * problems. When a reason contains a newline, indent every continuation line by
 * exactly two spaces after the `- `-prefixed first line. Apply this rendering to
 * every row problem, regardless of its source, so the number of `- `-prefixed
 * physical lines always equals the reported problem count. A newline can come from
 * an extra JSON key's name as well as from a schema exception message, so handling
 * only schema exceptions would make that count unreliable.
 */
export function loadCorpus<V, E>(file: URL | string, schemas: { value: ZodType<V>; expected: ZodType<E> }): readonly CorpusEntry<V, E>[] {
  if (!schemas || typeof schemas !== 'object' || !('value' in schemas) || !('expected' in schemas)) {
    throw new Error(`loadCorpus: invalid input: schemas argument is missing required schemas`);
  }

  let filePath: string;
  if (file instanceof URL) {
    if (file.protocol !== 'file:') {
      throw new Error(`loadCorpus: invalid input: file must be a file: URL`);
    }
    try {
      filePath = fileURLToPath(file);
    } catch (e) {
      throw new Error(`loadCorpus: invalid input: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (typeof file === 'string') {
    if (file.startsWith('http://') || file.startsWith('https://')) {
      throw new Error(`loadCorpus: invalid input: file must be a file: URL`);
    }
    if (!path.isAbsolute(file)) {
      throw new Error(`loadCorpus: invalid input: file must be an absolute path`);
    }
    filePath = file;
  } else {
    throw new Error(`loadCorpus: invalid input: file must be a string or URL`);
  }

  let rawBytes: Uint8Array;
  try {
    rawBytes = readFileSync(filePath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const errno = err?.errno || '';
    if (err?.code === 'ENOENT') {
      throw new Error(`loadCorpus: ${filePath}: 1 problem(s)\n- file: cannot read (ENOENT)`);
    } else if (err?.code === 'EISDIR') {
      throw new Error(`loadCorpus: ${filePath}: 1 problem(s)\n- file: cannot read (EISDIR)`);
    } else {
      throw new Error(`loadCorpus: ${filePath}: 1 problem(s)\n- file: cannot read (${err?.code || errno})`);
    }
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error(`loadCorpus: ${filePath}: 1 problem(s)\n- file: invalid UTF-8`);
  }

  if (rawBytes.length >= 3 && rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf) {
    throw new Error(`loadCorpus: ${filePath}: 1 problem(s)\n- file: starts with a UTF-8 BOM`);
  }

  const lines = text.split(/\r?\n/);
  const allProblems: string[] = [];
  const entries: CorpusEntry<V, E>[] = [];
  const seenValues = new Map<string, number>();

  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const nonEmptyLines = lines.filter(line => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    throw new Error(`loadCorpus: ${filePath}: 1 problem(s)\n- file: empty corpus (no rows)`);
  }

  for (const [i, line] of lines.entries()) {
    const lineNum = i + 1;

    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;

    if (normalizedLine.trim().length === 0) {
      pushProblem(allProblems, lineNum, 'blank line');
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(normalizedLine);
    } catch (e) {
      pushProblem(allProblems, lineNum, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      pushProblem(allProblems, lineNum, 'value is not a plain object');
      continue;
    }

    const hasValue = 'value' in parsed;
    const hasExpected = 'expected' in parsed;
    const hasNote = 'note' in parsed;
    const hasSource = 'source' in parsed;
    const hasDate = 'date' in parsed;

    if (!hasValue) {
      pushProblem(allProblems, lineNum, "missing required key 'value'");
      continue;
    }
    if (!hasExpected) {
      pushProblem(allProblems, lineNum, "missing required key 'expected'");
      continue;
    }
    if (!hasNote) {
      pushProblem(allProblems, lineNum, "missing required key 'note'");
      continue;
    }
    if (!hasSource) {
      pushProblem(allProblems, lineNum, "missing required key 'source'");
      continue;
    }
    if (!hasDate) {
      pushProblem(allProblems, lineNum, "missing required key 'date'");
      continue;
    }

    const keys = Object.keys(parsed);
    const allowedKeys = new Set(['value', 'expected', 'note', 'source', 'date']);
    const extraKeys = keys.filter(k => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      pushProblem(allProblems, lineNum, `has extra key(s): ${extraKeys.join(', ')}`);
      continue;
    }

    let value: V;
    try {
      value = schemas.value.parse(parsed.value);
    } catch (e) {
      pushProblem(allProblems, lineNum, `value schema threw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    let expected: E;
    try {
      expected = schemas.expected.parse(parsed.expected);
    } catch (e) {
      pushProblem(allProblems, lineNum, `expected schema threw: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const note = parsed.note;
    if (typeof note !== 'string' || note.trim().length === 0) {
      pushProblem(allProblems, lineNum, "'note' must be a non-blank string");
      continue;
    }

    const source = parsed.source;
    if (typeof source !== 'string' || !/^[#][1-9][0-9]*$/.test(source)) {
      pushProblem(allProblems, lineNum, "'source' must match '#' followed by digits with no leading zero (e.g. #1, #540)");
      continue;
    }

    const date = parsed.date;
    if (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
      pushProblem(allProblems, lineNum, "'date' must be in YYYY-MM-DD format");
      continue;
    }

    const dateObj = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(dateObj.getTime()) || dateObj.toISOString().slice(0, 10) !== date) {
      pushProblem(allProblems, lineNum, "'date' is not a valid calendar date");
      continue;
    }

    const valueStr = JSON.stringify(parsed.value);
    if (seenValues.has(valueStr)) {
      pushProblem(allProblems, lineNum, `duplicates value of line ${seenValues.get(valueStr)}`);
      continue;
    }
    seenValues.set(valueStr, lineNum);

    entries.push({
      value,
      expected,
      note,
      source,
      date,
      line: lineNum,
    });
  }

  if (allProblems.length > 0) {
    throw new Error(`loadCorpus: ${filePath}: ${allProblems.length} problem(s)\n${allProblems.join('\n')}`);
  }

  return entries;
}
