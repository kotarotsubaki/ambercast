import { z } from 'zod';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSecretLiteral } from '#usecases/generator-secret-policy.js';

const AMBERCAST_REF = /^(?:[0-9a-f]{7,40}|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Validates a provider's raw response together with the provenance needed to
 * reproduce it offline. Strict objects keep accidental fixture metadata from
 * silently changing the replay contract. An absent Codex output file remains
 * distinct from an empty file, and cross-field checks reject payloads that a
 * hanging call could never expose. Defaults describe an immediate, empty call.
 */
export const ProviderFixtureValue = z.strictObject({
  provider: z.enum(['claude-code-cli', 'codex-cli']),
  provenance: z.strictObject({
    ambercast: z.string().regex(AMBERCAST_REF),
    input: z.string().refine(s => s.trim() !== ''),
    origin: z.enum(['recorded', 'reconstructed', 'synthetic']),
    note: z.string().optional(),
    providerVersion: z.string().refine(s => s.trim() !== '').optional(),
  }),
  run: z.union([
    z.strictObject({ exitCode: z.int().min(0).max(255) }),
    z.strictObject({ signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']) }),
    z.strictObject({ hang: z.literal(true) }),
  ]),
  delayMs: z.int().min(0).max(30000).default(0),
  stdout: z.string().default(''),
  stderr: z.string().default(''),
  outputFile: z.string().optional(),
}).superRefine((fixture, ctx) => {
  if (fixture.provider === 'claude-code-cli' && fixture.outputFile !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'outputFile is codex-cli only' });
  }
  if ('hang' in fixture.run && (fixture.delayMs !== 0 || fixture.stdout !== '' || fixture.stderr !== '' || fixture.outputFile !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'hang fixture carries no payload or delay' });
  }
  if (fixture.provenance.origin === 'reconstructed' && (fixture.provenance.note === undefined || fixture.provenance.note.trim() === '')) {
    ctx.addIssue({ code: 'custom', message: 'reconstructed provenance requires note' });
  }
  if (fixture.provenance.origin === 'recorded' && fixture.provenance.providerVersion === undefined) {
    ctx.addIssue({ code: 'custom', message: 'recorded provenance requires providerVersion' });
  }
});

/** A validated fixture with replay defaults already applied. */
export type ProviderFixture = z.output<typeof ProviderFixtureValue>;

type StringFinding = { path: string; layer: number; detector: string; offset: number };
type KeyCounter = { next: number };
const PATTERNS: readonly [string, RegExp][] = [
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['github-token', /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['bearer-token', /\bBearer (?=[A-Za-z0-9._~+\/=-]*\d)[A-Za-z0-9._~+\/=-]{20,}/g],
];

/**
 * Keeps positional detection separate from JSON traversal so decoded layers
 * share the production prefix policy without inheriting plan-only exemptions.
 * ponytail: unprefixed high-entropy secrets and prefixes glued to another
 * token are outside this shape scanner; entropy would flag ordinary slugs.
 */
function inspectString(text: string): { detector: string; offset: number }[] {
  const neutralized = text.replace(/\\+(?:u[0-9a-fA-F]{4}|[nrtbf"\/])/g, match => ' '.repeat(match.length));
  const findings: { detector: string; offset: number }[] = [];
  for (const token of neutralized.matchAll(/[A-Za-z0-9_-]+/g)) {
    const detector = detectSecretLiteral(token[0]);
    if (detector === 'credential-prefix-sk' || detector === 'credential-prefix-ghp' || detector === 'credential-prefix-aws-access-key') {
      findings.push({ detector, offset: token.index });
    }
  }
  for (const [detector, pattern] of PATTERNS) {
    for (const match of neutralized.matchAll(pattern)) findings.push({ detector, offset: match.index });
  }
  return findings;
}

/**
 * Carries decoded-layer context through strings, keys, and descendants without
 * letting a credential-bearing key enter diagnostics. An isolated key probe
 * determines whether to redact before the real traversal allocates row-local
 * ordinals, leaving harmless keys and their encounter order intact.
 */
function walk(value: unknown, path: string, layer: number, counter: KeyCounter): StringFinding[] {
  if (typeof value === 'string') {
    const findings = inspectString(value).map(finding => ({ ...finding, path, layer }));
    if (layer < 3) {
      let decoded: unknown;
      try { decoded = JSON.parse(value); } catch { return findings; }
      findings.push(...walk(decoded, `${path}~${layer + 1}`, layer + 1, counter));
    }
    return findings;
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => walk(item, `${path}[${index}]`, layer, counter));
  if (value !== null && typeof value === 'object') {
    const findings: StringFinding[] = [];
    for (const [key, child] of Object.entries(value)) {
      const secretKey = walk(key, '', layer, { ...counter }).length > 0;
      const childPath = secretKey ? `${path}[redacted-key#${counter.next++}]` : path === '' ? key : `${path}.${key}`;
      if (secretKey) findings.push(...walk(key, childPath, layer, counter));
      findings.push(...walk(child, childPath, layer, counter));
    }
    return findings;
  }
  return [];
}

/**
 * Finds credential shapes without returning the matched secret itself.
 * Escape neutralization preserves UTF-16 offsets while separating adjacent
 * tokens. JSON strings are decoded through at most three layers, including
 * object keys, so an encoded provider wrapper cannot hide a credential.
 * Offsets refer to the innermost string inspected, rather than the wrapper.
 */
export function findCredentialLiterals(text: string): { detector: string; offset: number }[] {
  return walk(text, '', 0, { next: 1 }).map(({ detector, offset }) => ({ detector, offset }));
}

/**
 * Checks every JSONL row beneath a corpus directory for credential shapes.
 * Findings retain relative POSIX filenames, physical line numbers, and decoded
 * string paths while concealing credential-bearing keys and their descendants.
 * Redacted keys are numbered from one within each row in depth-first encounter
 * order. Malformed or blank interior lines produce findings; unreadable files
 * throw so incomplete inspection cannot appear clean. Deduplication includes
 * the decoding layer, while presentation orders by file, line, path, offset,
 * and detector. Structural validation remains the caller's loadCorpus task.
 */
export function scanProviderOutputCorpus(dir: URL | string): {
  file: string; line: number; path: string; layer: number; detector: string; offset: number;
}[] {
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  const findings: (StringFinding & { file: string; line: number })[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const filename = join(entry.parentPath, entry.name);
    const file = relative(root, filename).split(sep).join('/');
    const lines = readFileSync(filename, 'utf8').split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    for (const [index, text] of lines.entries()) {
      let value: unknown;
      try { value = JSON.parse(text); } catch {
        findings.push({ file, line: index + 1, path: '', layer: 0, detector: 'unparseable-line', offset: 0 });
        continue;
      }
      findings.push(...walk(value, '', 0, { next: 1 }).map(finding => ({ ...finding, file, line: index + 1 })));
    }
  }
  const unique = new Map(findings.map(finding => [JSON.stringify([
    finding.file, finding.line, finding.path, finding.layer, finding.offset, finding.detector,
  ]), finding]));
  return [...unique.values()].sort((a, b) =>
    compareText(a.file, b.file) || a.line - b.line || compareText(a.path, b.path) ||
    a.offset - b.offset || compareText(a.detector, b.detector));
}

/** Locale-independent lexical comparison keeps corpus diagnostics reproducible. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
