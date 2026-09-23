import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { listDocsCorpus, maskForClaims, normalizeClaimLine, claimHash } from './lib/docs-corpus.mjs';

const snapshots = ['test/fixtures/cli-manifest.json', 'test/fixtures/capabilities.json', 'test/fixtures/config-schema.json'];
const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
function git(repoRoot, ...args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}
function flagIdentifiers(manifest) {
  return (manifest.commands ?? []).flatMap((command) => (command.flags ?? []).flatMap((flag) => [flag.name, flag.alias].filter(Boolean).map((name) => `flag:${command.name}:--${name.replace(/^-+/, '')}`)));
}
function configIdentifiers(schema) {
  const result = [];
  function visit(node, prefix = '') {
    for (const [name, value] of Object.entries(node?.properties ?? {})) {
      const path = prefix ? `${prefix}.${name}` : name;
      result.push(`config:${path}`);
      visit(value, path);
    }
    for (const key of ['additionalProperties', 'patternProperties']) {
      const value = node?.[key];
      if (value && typeof value === 'object') {
        const path = prefix ? `${prefix}.*` : '*';
        result.push(`config:${path}`);
        if (key === 'patternProperties') for (const nested of Object.values(value)) visit(nested, path);
        else visit(value, path);
      }
    }
  }
  visit(schema);
  return result;
}
function identifiers([manifest, capabilities, schema]) {
  return [
    ...((manifest.commands ?? []).map(({ name }) => `command:${name}`)),
    ...flagIdentifiers(manifest),
    ...((capabilities.planned ?? []).map((name) => `planned:${name}`)),
    ...configIdentifiers(schema),
  ];
}

/**
 * Reports advisory candidates for public identifier changes without treating them as
 * hard claim failures. The CLI accepts prospective repeated identifiers with
 * no git access, or actual --base snapshots plus working-tree snapshots. It validates
 * arguments and required inputs before writing stdout, then emits candidate JSONL.
 * A plan, when supplied, is parsed before candidates are computed: missing or malformed
 * Docs impact sections produce plan-invalid and exit 1. Undisposed candidates produce
 * one diagnostic per id and exit 1; otherwise advisory output exits 0. Malformed CLI,
 * unreadable snapshots or allowlist, and unresolved bases leave stdout empty and exit 2.
 *
 * @returns {Promise<void>} Reports candidate JSONL and plan disposition errors.
 */
export async function main() {
  let mode, base, plan, repoRoot = resolve('..');
  const prospective = [];
  try {
    for (let index = 2; index < process.argv.length; index += 1) {
      const arg = process.argv[index];
      if (arg === '--prospective' || arg === '--actual') { if (mode) throw new Error('conflicting modes'); mode = arg.slice(2); }
      else if (['--identifier', '--base', '--plan', '--repo-root'].includes(arg)) {
        const value = process.argv[++index];
        if (!value || value.startsWith('--')) throw new Error(`missing ${arg}`);
        if (arg === '--identifier') {
          if (!/^(?:command:[^:]+|flag:[^:]+:--[^:]+|planned:[^:]+|config:[A-Za-z0-9_.*-]+)$/.test(value)) throw new Error(`invalid identifier ${value}`);
          prospective.push(value);
        }
        if (arg === '--base') base = value;
        if (arg === '--plan') plan = value;
        if (arg === '--repo-root') repoRoot = resolve(value);
      } else throw new Error(`invalid argument ${arg}`);
    }
    if (mode === 'prospective') {
      if (!prospective.length || base || new Set(prospective).size !== prospective.length) throw new Error('invalid prospective arguments');
    } else if (mode === 'actual') {
      if (!base || prospective.length) throw new Error('invalid actual arguments');
    } else throw new Error('missing mode');
    const capabilities = JSON.parse(await readFile(join(repoRoot, 'website/public/capabilities.json'), 'utf8'));
    const allowlist = JSON.parse(await readFile(join(repoRoot, 'website/docs-audit-allowlist.json'), 'utf8'));
    const corpus = await listDocsCorpus({ repoRoot });
    const changedPaths = new Set();
    let changed = prospective;
    if (mode === 'actual') {
      changed = await changedIdentifiers(repoRoot, base);
      for (const path of git(repoRoot, 'diff', '--name-only', base).trim().split('\n')) if (path) changedPaths.add(path);
    }
    let dispositions;
    if (plan) {
      try { dispositions = await readDispositions(resolve(plan)); }
      catch (error) { process.stderr.write(`plan-invalid ${error.message}\n`); process.exitCode = 1; return; }
    }
    const candidates = await collectCandidates({ identifiers: changed, corpus, capabilities, mode, changedPaths, allowlist, repoRoot });
    if (dispositions && candidates.length === 0 && !dispositions.has('No candidates.')) {
      process.stderr.write('plan-invalid missing No candidates.\n'); process.exitCode = 1; return;
    }
    for (const candidate of candidates) process.stdout.write(`${JSON.stringify(candidate)}\n`);
    const missing = candidates.filter(({ id }) => dispositions && !dispositions.has(id));
    for (const { id } of missing) process.stderr.write(`undisposed ${id}\n`);
    process.exitCode = missing.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`docs-impact: ${error.message}\n`);
    process.exitCode = 2;
  }
}

/**
 * Extracts changed public identifiers without conflating availability states. The
 * actual-mode reader obtains each of the three committed snapshot paths at
 * base with git show (a path absent at base is an empty set) and from the working tree.
 * It derives command, alias-inclusive flag, planned, and dotted config identifiers;
 * additionalProperties and patternProperties become wildcard path segments. Added
 * and removed command and planned sets are diffed independently, so a move emits both
 * its old and new identifiers. Prospective mode bypasses this reader entirely.
 *
 * @param {string} repoRoot Repository containing the snapshots.
 * @param {string} base Git reference to compare with the working tree.
 * @returns {Promise<string[]>} Changed identifiers, including both sides of moves.
 */
async function changedIdentifiers(repoRoot, base) {
  git(repoRoot, 'rev-parse', '--verify', `${base}^{commit}`);
  const before = [];
  const after = [];
  for (const path of snapshots) {
    const result = spawnSync('git', ['-C', repoRoot, 'show', `${base}:${path}`], { encoding: 'utf8' });
    if (result.status !== 0 && !/does not exist|exists on disk, but not in|path .* not in/.test(result.stderr)) throw new Error(result.stderr.trim());
    before.push(result.status === 0 ? JSON.parse(result.stdout) : {});
    after.push(JSON.parse(await readFile(join(repoRoot, path), 'utf8')));
  }
  const old = new Set(identifiers(before));
  const current = new Set(identifiers(after));
  return [...new Set([...old].filter((id) => !current.has(id)).concat([...current].filter((id) => !old.has(id))))].sort();
}

/**
 * Computes review candidates over the shared corpus, leaving role selection specific
 * to each rule. Identifier hits scan source and golden entries, collapse repeated hits
 * by identifier and path, and in actual mode exclude git-changed paths. Planned
 * and universal claims stay source-only by design; only identifier-hit scans
 * golden too. SPEC-10's entire-corpus scope means the raw, unfiltered candidate set is
 * computed unconditionally, not that claim rules scan additional roles.
 * Universal claims are emitted only for command or flag changes, while stale
 * advisory entries are checked against raw claims even when those claims would
 * not be emitted. Advisory allowlist matches suppress only planned and universal
 * claims.
 *
 * Candidate identity uses SHA-256 over UTF-8 bytes, first 12 lowercase hex digits:
 * identifier-hit hashes identifier, newline, path; every other rule hashes path,
 * newline, and the shared normalized masked line. The rule prefixes that digest.
 * This common normalization prevents the hard allowlist and advisory output from
 * assigning different identities to the same text.
 * Candidate text retains the original, unmasked line for operator legibility.
 *
 * @param {{ identifiers: string[], corpus: Array<{ path: string, role: 'source' | 'golden', locale: string }>, capabilities: object, mode: 'prospective' | 'actual', changedPaths: Set<string>, allowlist: object[], repoRoot: string }} input
 * Validated identifiers (from repeated --identifier or actual-mode diffing), source
 * and golden corpus entries, capabilities for planned/command token vocabularies,
 * mode, git-changed paths, allowlist entries, and repository root. main computes
 * changedPaths with `git diff --name-only <base>` in actual mode and passes that set
 * here; it passes an empty set in prospective mode. collectCandidates does not
 * recompute git-changed paths.
 * @returns {Promise<object[]>} Stable candidate records for JSONL serialization.
 */
async function collectCandidates(input) {
  const { identifiers: changed, corpus, capabilities, mode, changedPaths, allowlist, repoRoot } = input;
  const records = new Map();
  const available = new Set(capabilities.commands ?? []);
  const commandChanged = changed.some((id) => /^(?:command|flag):/.test(id));
  const rawClaims = [];
  function add(rule, path, line, identifier, role, text, normalized, force = false) {
    const key = rule === 'identifier-hit' ? `${identifier}\n${path}` : `${path}\n${normalized}`;
    const id = `${rule}:${digest(key)}`;
    const record = { id, rule, path, line, identifier, role, text };
    if (force) rawClaims.push({ ...record, claimHash: claimHash(normalized) });
    else records.set(id, record);
  }
  function hit(line, id) {
    const [kind, ...parts] = id.split(':');
    if (kind === 'command' || kind === 'planned') {
      const name = parts[0];
      return line.includes(`\`${name}\``) || new RegExp(`\\bambercast ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line);
    }
    if (kind === 'flag') {
      const name = parts.at(-1).replace(/^-+/, '');
      const dashes = name.length === 1 ? '--?' : '--';
      return new RegExp(`(?<![\\w-])${dashes}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(line);
    }
    if (kind === 'config') {
      const path = parts.join(':');
      return line.includes(`\`${path}\``) || line.includes(`\`${path.split('.').at(-1)}\``);
    }
    return false;
  }
  for (const { path, role, locale } of corpus) {
    const source = await readFile(join(repoRoot, path), 'utf8');
    const masked = maskForClaims(source).split('\n');
    const original = source.split('\n');
    for (let index = 0; index < masked.length; index += 1) {
      const line = masked[index];
      const normalized = normalizeClaimLine(line);
      for (const id of changed) if ((mode !== 'actual' || !changedPaths.has(path)) && hit(line, id)) add('identifier-hit', path, index + 1, id, role, original[index], normalized);
      if (role !== 'source') continue;
      const token = [...line.matchAll(/`([^`]+)`/g)].find((match) => available.has(match[1]));
      const planned = token && (locale === 'ja' ? /未実装|予定|まだ/.test(line) : locale === 'zh-cn' ? /计划|尚未|尚无|暂未/.test(line) : /\b(?:planned|not implemented|not yet|planned-only|rejected)\b/i.test(line) || /\bno\s+$/.test(line.slice(0, token.index)));
      if (planned) add('planned-claim', path, index + 1, `command:${token[1]}`, role, original[index], normalized, true);
      const universal = /\b(?:every|all|each|exactly|only|four|five|six|seven|eight|nine|ten)\b|[4-9]つ|[四五六七八九]个/i.test(line) && /command/i.test(line);
      if (universal) add('universal-claim', path, index + 1, '', role, original[index], normalized, true);
    }
  }
  for (const claim of rawClaims) {
    const suppressed = allowlist.some((entry) => entry.scope === 'advisory' && entry.rule === claim.rule && entry.path === claim.path && entry.claimHash === claim.claimHash);
    if (!suppressed && (claim.rule === 'planned-claim' || commandChanged)) {
      const { claimHash: _hash, ...record } = claim;
      records.set(record.id, record);
    }
  }
  for (const entry of allowlist.filter(({ scope }) => scope === 'advisory')) {
    if (!rawClaims.some((claim) => claim.rule === entry.rule && claim.path === entry.path && claim.claimHash === entry.claimHash)) {
      // Stale entries have no source line: placeholders keep records deterministic,
      // with identity from the entry's own path and claimHash; no spec or test fixes these fields further.
      add('allowlist-stale', entry.path, 0, '', 'source', entry.claimHash, entry.claimHash);
    }
  }
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Validates a disposition document before candidate generation can hide a malformed
 * plan. The parser reads only the Docs impact H2 section up to the next H2,
 * accepts update/keep entries with a nonempty reason and either supported dash, and
 * rejects every malformed line beginning with a list marker. Even when there are no
 * candidates, the section must contain No candidates. A missing file or section is
 * plan-invalid rather than an input-error exit.
 *
 * @param {string} path Plan path supplied by --plan.
 * @returns {Promise<Set<string>>} Candidate ids with dispositions.
 */
async function readDispositions(path) {
  const source = await readFile(path, 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Docs impact');
  if (start < 0) throw new Error('missing Docs impact section');
  const ids = new Set();
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    if (line.trim() === 'No candidates.') ids.add('No candidates.');
    if (line.startsWith('- ')) {
      const match = /^- (\S+): (?:update|keep) (?:—|-) (.+)$/.exec(line);
      if (!match) throw new Error(`malformed disposition: ${line}`);
      ids.add(match[1]);
    }
  }
  return ids;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
