import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Maps each supported Conventional Commit type to its additive PR type label.
 * Every valid title type has exactly one entry and yields exactly one type label.
 */
export const TYPE_LABELS = {
  feat: 'type: feature',
  fix: 'type: bug',
  docs: 'type: docs',
  refactor: 'type: refactor',
  test: 'type: test',
  chore: 'type: chore',
};

/**
 * Maps recognized Conventional Commit scopes to PR area names.
 * Unrecognized scopes contribute no area label; callers must check own keys
 * because this plain object's prototype is not part of the mapping.
 */
export const SCOPE_AREA = {
  website: 'website',
  run: 'runner',
  browser: 'runner',
  'adapters/browser': 'runner',
  executor: 'executor',
  heal: 'heal',
  grounding: 'heal',
  mcp: 'mcp',
  'core/ir': 'ir',
  ir: 'ir',
  schema: 'ir',
  spec: 'ir',
  check: 'ir',
  cli: 'cli',
  init: 'cli',
  config: 'cli',
  view: 'viewer',
  secrets: 'secrets',
  report: 'report',
  generate: 'generate',
  generator: 'generate',
  ai: 'generate',
  'adapters/ai': 'generate',
  'ports/ai': 'generate',
  hooks: 'workflow',
  implement: 'workflow',
  flow: 'workflow',
  workflow: 'workflow',
  skill: 'workflow',
  codex: 'workflow',
  ops: 'workflow',
  scripts: 'workflow',
  agents: 'workflow',
  architecture: 'infra',
  ci: 'infra',
  deps: 'infra',
  'deps-dev': 'infra',
  main: 'infra',
  release: 'infra',
  test: 'infra',
  e2e: 'infra',
  lint: 'infra',
  gitignore: 'infra',
};

// Capturing variant of pr-title.yml's validation regex (type, scope, `!`).
const TITLE = /^(feat|fix|docs|refactor|test|chore)(?:\(([a-z0-9][a-z0-9._/-]*)\))?(!)?: \S.*$/;
const MCP_WORD = /\bmcp\b/i;

/**
 * Derives additive PR labels from a Conventional Commit title.
 *
 * @param {string | null | undefined} title - The pull request title.
 * @returns {{ labels: string[] }} Labels in type, breaking-change, then area order; an invalid title yields an empty list.
 * @remarks
 * The scope lookup uses `Object.hasOwn(SCOPE_AREA, scope)` because the
 * mapping is a plain object. An unmapped scope yields only the type label;
 * a valid but unmapped `constructor` scope would otherwise resolve an inherited
 * prototype member and produce a bogus area label. A standalone word `MCP`
 * anywhere in the title, regardless of scope and case, adds `area: mcp` only
 * if the scope has not already added it. The keyword check runs only after
 * the title matches the Conventional Commit grammar: #505 derives labels
 * from structured titles, while the separate required PR-title check
 * prevents malformed titles from merging.
 */
export function deriveLabels(title) {
  const match = TITLE.exec(title ?? '');
  if (!match) return { labels: [] };
  const [, type, scope, breaking] = match;
  const labels = [TYPE_LABELS[type]];
  if (breaking) labels.push('breaking-change');
  if (scope && Object.hasOwn(SCOPE_AREA, scope)) labels.push(`area: ${SCOPE_AREA[scope]}`);
  if (MCP_WORD.test(title) && !labels.includes('area: mcp')) labels.push('area: mcp');
  return { labels };
}

/**
 * Adds labels derived from the PR title and assigns the author when unassigned.
 *
 * @remarks
 * The sole caller, `pr-label.yml`, supplies `PR_TITLE`, `PR_NUMBER`, and
 * `PR_AUTHOR`; direct invocation with missing values uses empty strings.
 * Assignment uses the PR's current assignees, preserving human assignments
 * made after the workflow event. A failed lookup never permits assignment.
 * Labeling and assignment are independent: failures log an operation-specific
 * `::error::` and set `process.exitCode = 1` without throwing.
 */
async function main() {
  const exec = ({ cmd, args }) => {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    // A failed launch has no process exit status.
    const code = result.error ? null : result.status;
    return {
      code,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };

  const title = process.env.PR_TITLE ?? '';
  const prNumber = process.env.PR_NUMBER ?? '';
  const prAuthor = process.env.PR_AUTHOR ?? '';

  const { labels } = deriveLabels(title);

  if (labels.length) {
    const labelArgs = ['pr', 'edit', prNumber, ...labels.flatMap((l) => ['--add-label', l])];
    const result = exec({ cmd: 'gh', args: labelArgs });
    if (result.code !== 0) {
      console.log(`::error::gh pr edit label failed: ${result.stderr}`);
      process.exitCode = 1;
    }
  }

  const assigneesResult = exec({ cmd: 'gh', args: ['pr', 'view', prNumber, '--json', 'assignees'] });
  if (assigneesResult.code !== 0) {
    console.log(`::error::gh pr view assignees failed: ${assigneesResult.stderr}`);
    process.exitCode = 1;
    return;
  }

  let assignees;
  try {
    assignees = JSON.parse(assigneesResult.stdout).assignees;
    if (!Array.isArray(assignees)) throw new Error('assignees is not an array');
  } catch (error) {
    console.log(`::error::gh pr view assignees failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (assignees.length === 0) {
    const assigneeArgs = ['pr', 'edit', prNumber, '--add-assignee', prAuthor];
    const result = exec({ cmd: 'gh', args: assigneeArgs });
    if (result.code !== 0) {
      console.log(`::error::gh pr edit assignee failed: ${result.stderr}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
