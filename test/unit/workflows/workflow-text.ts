import { readFileSync } from 'node:fs';

function normalizedLines(workflowText: string): string[] {
  return workflowText.replaceAll('\r', '').split('\n');
}

function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

function stripTrailingComment(line: string): string {
  return line.replace(/\s+#.*$/, '');
}

/**
 * Extracts a job identifier from a line that looks like a job heading.
 *
 * Strips a trailing `# comment` from the line (via `stripTrailingComment()`)
 * before matching the job ID grammar (`^[A-Za-z_][A-Za-z0-9_-]*$`). Returns
 * the identifier if the line matches the heading pattern, or `undefined`
 * otherwise.
 */
function jobHeading(line: string): string | undefined {
  return /^  ([A-Za-z_][A-Za-z0-9_-]*):$/.exec(stripTrailingComment(line))?.[1];
}

/**
 * Reads workflow text through the grammar's shared normalization boundary.
 *
 * The parser removes carriage returns before it extracts any block, so this
 * deliberately returns normalized line-feed text even for a CRLF fixture.
 * In particular, later raw-block comparisons retain comment lines, but
 * "raw" never promises preservation of the source file's original CRLF
 * bytes.
 *
 * Read failures deliberately propagate as Node errors. These paths identify
 * test-internal fixtures or repository files rather than external user input,
 * so an absent or unreadable file is the correct broken-fixture signal rather
 * than a condition this helper should recover from.
 */
export function readWorkflowText(filePath: string): string {
  return normalizedLines(readFileSync(filePath, 'utf8')).join('\n');
}

/**
 * Returns the trigger names declared in the top-level `on:` mapping.
 *
 * A missing exact `on:` line throws because every workflow covered by these
 * contract tests must state its triggers; its absence makes the fixture or
 * repository file malformed rather than an empty trigger set. The boundary at
 * the next non-indented line keeps nested trigger configuration from being
 * mistaken for another top-level workflow field.
 */
export function getOnKeys(workflowText: string): Set<string> {
  const lines = normalizedLines(workflowText);
  const onIndex = lines.findIndex((line) => line === 'on:');

  if (onIndex === -1) {
    throw new Error('Workflow has no on: block.');
  }

  const keys = new Set<string>();
  for (const line of lines.slice(onIndex + 1)) {
    if (/^\S/.test(line)) {
      break;
    }

    const match = /^  ([a-z_]+):/.exec(line);
    if (match !== null) {
      const key = match[1];
      if (key === undefined) {
        throw new Error(`Workflow trigger line has no key: ${line}`);
      }
      keys.add(key);
    }
  }

  return keys;
}

/**
 * Returns one job's normalized raw block, retaining its whole comment lines.
 *
 * Job headings are considered only after `jobs:`. Applying the same heading
 * pattern to an entire workflow would incorrectly classify `on: -> push:` in
 * `release-please.yml` as a job and make the required four-job assertion
 * fail for a correct workflow. This comment-retaining view is used for the
 * later exact-string comparison; a trailing comment belongs to the preceding
 * job, while trailing blank spacing does not, so only blank lines are trimmed.
 * It throws when `jobs:` is absent or the requested job cannot be found after
 * it, because either shape makes the workflow fixture malformed for a
 * job-specific assertion instead of yielding a safely empty block.
 */
export function getJobLines(workflowText: string, jobName: string): string[] {
  const lines = normalizedLines(workflowText);
  const jobsIndex = lines.findIndex((line) => line === 'jobs:');

  if (jobsIndex === -1) {
    throw new Error('Workflow has no jobs: block.');
  }

  const jobIndex = lines.findIndex((line, index) => index > jobsIndex && jobHeading(line) === jobName);
  if (jobIndex === -1) {
    throw new Error(`Job "${jobName}" was not found after jobs:.`);
  }

  let endIndex = lines.length;
  for (let index = jobIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      throw new Error(`Workflow line ${index} is unexpectedly missing.`);
    }
    if (jobHeading(line) !== undefined) {
      endIndex = index;
      break;
    }
  }

  const block = lines.slice(jobIndex, endIndex);
  while (block.at(-1)?.trim() === '') {
    block.pop();
  }

  return block;
}

/**
 * Returns a job block for token and field checks with whole comment lines removed.
 *
 * This derives the scan view from {@link getJobLines} instead of independently
 * parsing the file, preserving the exact same job boundary. The separate views
 * are necessary because the frozen release-job assertion needs raw,
 * comment-including text, whereas all other checks must ignore commented-out
 * fields and forbidden tokens. Inline pin comments remain scannable because a
 * `uses:` line is not itself a comment line.
 * The same missing-`jobs:` and unknown-job errors propagate from the raw view,
 * preserving its fail-fast malformed-fixture contract instead of turning a
 * missing target into an empty scan that could hide a broken assertion.
 */
export function getScannableJobLines(workflowText: string, jobName: string): string[] {
  return getJobLines(workflowText, jobName).filter((line) => !isCommentLine(line));
}

/**
 * Splits the scan-view `steps:` tail of a job into its individual step blocks.
 *
 * Callers provide the comment-free view so commented-out operations cannot
 * become steps or satisfy a security token check. The job boundary already
 * limits the input and every covered workflow places `steps:` last, therefore
 * the next step marker or the end of this input is the only block boundary.
 * An input without the exact `steps:` line throws: callers pass a job that is
 * expected to define steps, and treating a malformed job as zero steps would
 * let a structural fixture failure look like a valid empty operation list.
 */
export function splitStepsIntoBlocks(jobLines: string[]): string[][] {
  const stepsIndex = jobLines.findIndex((line) => line === '    steps:');
  if (stepsIndex === -1) {
    throw new Error('Job has no steps: section.');
  }

  const blocks: string[][] = [];
  let currentBlock: string[] | undefined;
  for (const line of jobLines.slice(stepsIndex + 1)) {
    if (/^      - /.test(line)) {
      if (currentBlock !== undefined) {
        blocks.push(currentBlock);
      }
      currentBlock = [line];
    } else if (currentBlock !== undefined) {
      currentBlock.push(line);
    }
  }

  if (currentBlock !== undefined) {
    blocks.push(currentBlock);
  }

  return blocks;
}

/**
 * Represents a parsed job from a GitHub Actions workflow.
 *
 * The `id` is the job's identifier as declared in the workflow YAML. `ifExpr`
 * holds the raw expression from the job-level `if:` line, if present; it is
 * optional because jobs without an explicit `if:` inherit the implicit
 * `success()` behavior from GitHub Actions. `needs` is an empty array both
 * when the job has no `needs:` clause at all and when it declares an
 * explicit, empty `needs: []`; a non-empty `needs` array always holds at
 * least one dependency name.
 *
 * The design deliberately exposes the raw `if:` value without parsing it into
 * an AST: this type serves static analysis tools that need to inspect or
 * compare expressions as strings, not evaluate them.
 */
export type JobInfo = { id: string; ifExpr?: string; needs: string[] };

/**
 * Parses all jobs defined in a workflow text and returns their structured
 * metadata.
 *
 * This function walks the `jobs:` block using the shared `jobHeading()`
 * boundary, reusing the existing block-start and block-end detection logic
 * from `getJobLines`. By relying on the single authoritative regex, it
 * guarantees consistent job detection across all workflow-parsing helpers.
 *
 * Any line at 2-space indent that looks like a job heading but fails the job
 * ID grammar (`^[A-Za-z_][A-Za-z0-9_-]*$`) is treated as a structural parsing
 * error and throws `Invalid job id "<key>".`. This is intentional: `listJobs`
 * serves as a static checker, not a best-effort parser, so malformed fixtures
 * fail fast rather than silently skipping unrecognized entries. Both the
 * heading-acceptance path (`jobHeading()`) and the invalid-job-id rejection
 * path call the same `stripTrailingComment()` helper before validating a
 * candidate line's grammar, so a comment-suffixed valid heading and a
 * comment-suffixed malformed heading are recognized identically by both
 * paths rather than risking the two independently diverging.
 *
 * Duplicate job IDs within the same file throw `Duplicate job id "<id>".`,
 * ensuring the workflow's job namespace is well-formed.
 *
 * Each job's `needs:` is parsed in three forms, all stripping one layer of
 * matching single or double quotes from each entry:
 * - **bare scalar**: `needs: <name>` — a single unquoted or quoted name.
 * - **inline array**: `needs: [<names>]` — comma-separated entries, with
 *   `needs: []` (empty) returning an empty array `[]` (no error).
 * - **block array**: `needs:` followed by `  - <name>` lines, each with
 *   trailing comment (`#.*`) stripped before unquoting. Deciding bare-scalar
 *   vs. block-array, and collecting the block-array's items, both skip blank
 *   and comment-only lines via one shared `isBlankOrCommentLine` predicate
 *   (so neither sees blank/comment lines as a terminator): the lookahead
 *   advances past them to the *next significant* line after `needs:` to make
 *   that decision, and the collection loop likewise skips them between items
 *   (and before the first item), collecting every `- <name>` entry until a
 *   true terminator (next job heading or sibling job-level key) is reached.
 *
 * A name that does not match the job-ID grammar, or does not name a job
 * present in this file's output, throws `needs references unknown job "<name>"
 * from "<id>".`. A name repeated within the same job's `needs` throws
 * `Duplicate needs entry "<name>" in job "<id>".`. A job with multiple
 * `needs:` keys (distinct `needs:` lines at the same indentation level)
 * throws `Duplicate needs: key in job "<id>".`.
 *
 * The returned array preserves the declaration order of jobs as they appear
 * in the workflow text. A job-level `if:` written as a multi-line block or
 * folded scalar (`if: >` / `if: |`) is not rejected here: its raw marker
 * (`">"` or `"|"`) is returned as that job's `ifExpr` unvalidated, because
 * whether a folded `if:` is actually an error depends on whether the job is
 * subject to the cancelled-propagation rule — a determination only
 * `checkCancelledPropagation` can make (see its documentation).
 *
 * Note: `listJobs` does not accept a `workflowLabel` parameter because it is
 * only used for structured metadata extraction; the caller (which knows the
 * source file) supplies that context when needed. Only `checkCancelledPropagation`
 * takes a `workflowLabel` because its `Violation.workflow` field must identify
 * which file contains each violation.
 *
 * @param workflowText - The YAML workflow text to parse.
 * @returns An array of job metadata, ordered by declaration.
 * @throws {Error} If the workflow is malformed (missing `jobs:` block),
 *   contains invalid job IDs, duplicate job IDs, unparseable needs, unknown
 *   job references, duplicate needs entries, or duplicate needs: keys.
 */
export function listJobs(workflowText: string): JobInfo[] {
  const lines = normalizedLines(workflowText);
  const jobsIndex = lines.findIndex((line) => line === 'jobs:');

  if (jobsIndex === -1) {
    throw new Error('Workflow has no jobs: block.');
  }

  const jobInfos: JobInfo[] = [];
  const jobIdSet = new Set<string>();
  let currentJobName: string | undefined;
  let currentJobLines: string[] = [];

  function finalizeJob() {
    if (currentJobName === undefined) return;

    const ifExpr = extractJobIf(currentJobLines);
    const needs = parseNeeds(currentJobLines, currentJobName);

    if (jobIdSet.has(currentJobName)) {
      throw new Error(`Duplicate job id "${currentJobName}".`);
    }
    jobIdSet.add(currentJobName);

    jobInfos.push(ifExpr === undefined ? { id: currentJobName, needs } : { id: currentJobName, ifExpr, needs });
  }

  for (let i = jobsIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      throw new Error(`Workflow line ${i} is unexpectedly missing.`);
    }

    const heading = jobHeading(line);
    if (heading !== undefined) {
      finalizeJob();
      currentJobName = heading;
      currentJobLines = [line];
    } else if (currentJobName !== undefined) {
      const maybeJobLine = /^  (?!#)(\S.*):$/.exec(stripTrailingComment(line));
      if (maybeJobLine !== null) {
        const key = maybeJobLine[1];
        throw new Error(`Invalid job id "${key}".`);
      }
      currentJobLines.push(line);
    } else {
      const maybeJobLine = /^  (?!#)(\S.*):$/.exec(stripTrailingComment(line));
      if (maybeJobLine !== null) {
        const key = maybeJobLine[1];
        throw new Error(`Invalid job id "${key}".`);
      }
    }
  }

  finalizeJob();

  // Resolve references after collecting every heading so forward dependencies remain valid.
  for (const job of jobInfos) {
    for (const need of job.needs) {
      if (!jobIdSet.has(need)) {
        throw new Error(`needs references unknown job "${need}" from "${job.id}".`);
      }
    }
  }

  detectNeedsCycle(jobInfos);

  return jobInfos;
}

function extractJobIf(lines: string[]): string | undefined {
  for (const line of lines) {
    if (line.startsWith('    if:')) {
      const match = /^    if: (.+)$/.exec(line);
      if (match !== null) {
        return match[1]!;
      }
    }
  }
  return undefined;
}

function isBlankOrCommentLine(line: string): boolean {
  return line.trim() === '' || isCommentLine(line);
}

function nextSignificantLineIndex(lines: string[], fromIndex: number): number | undefined {
  for (let i = fromIndex; i < lines.length; i++) {
    if (!isBlankOrCommentLine(lines[i]!)) return i;
  }
  return undefined;
}

function parseNeeds(lines: string[], jobId: string): string[] {
  const needsIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('    needs:')) needsIndices.push(i);
  }
  if (needsIndices.length > 1) {
    throw new Error(`Duplicate needs: key in job "${jobId}".`);
  }
  const needsLineIndex = needsIndices[0];
  if (needsLineIndex === undefined) {
    return [];
  }

  const needsLine = lines[needsLineIndex]!;
  const value = needsLine.slice('    needs:'.length).replace(/\s+#.*$/, '').trim();

  if (value.startsWith('>') || value.startsWith('|')) {
    throw new Error(`Unparseable needs: in job "${jobId}".`);
  }

  if (!value.startsWith('[')) {
    const nextSignificant = nextSignificantLineIndex(lines, needsLineIndex + 1);
    const nextIsBlockItem = nextSignificant !== undefined && /^      - /.test(lines[nextSignificant]!);
    if (value !== '' && nextIsBlockItem) {
      throw new Error(`Unparseable needs: in job "${jobId}".`);
    }
    const isBlockArray = value === '' && nextIsBlockItem;

    if (!isBlockArray) {
      const unquoted = stripQuotes(value);
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(unquoted)) {
        throw new Error(`needs references unknown job "${unquoted}" from "${jobId}".`);
      }
      return [unquoted];
    }
  }

  if (value.startsWith('[')) {
    const endBracket = value.indexOf(']');
    if (endBracket === -1 || value.slice(endBracket + 1).trim() !== '') {
      throw new Error(`Unparseable needs: in job "${jobId}".`);
    }
    const inner = value.slice(1, endBracket);
    if (inner.trim() === '') {
      return [];
    }
    const entries = inner.split(',').map((e) => stripQuotes(e.trim()));
    validateNeedsEntries(entries, jobId);
    return entries;
  }

  const blockArrayLines: string[] = [];
  for (let i = needsLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (isBlankOrCommentLine(line)) continue;
    const itemMatch = /^      - (.+)$/.exec(line);
    if (itemMatch === null) break;
    let item = itemMatch[1]!;
    const hashIdx = item.indexOf('#');
    if (hashIdx !== -1) item = item.slice(0, hashIdx).trim();
    if (item !== '') blockArrayLines.push(stripQuotes(item));
  }

  if (blockArrayLines.length > 0) {
    validateNeedsEntries(blockArrayLines, jobId);
    return blockArrayLines;
  }

  throw new Error(`Unparseable needs: in job "${jobId}".`);
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function validateNeedsEntries(entries: string[], jobId: string) {
  const seen = new Set<string>();
  for (const entry of entries) {
    // Validate job ID format
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(entry)) {
      throw new Error(`needs references unknown job "${entry}" from "${jobId}".`);
    }
    if (seen.has(entry)) {
      throw new Error(`Duplicate needs entry "${entry}" in job "${jobId}".`);
    }
    seen.add(entry);
  }
}

function detectNeedsCycle(jobInfos: JobInfo[]) {
  const jobMap = new Map<string, JobInfo>();
  for (const job of jobInfos) {
    jobMap.set(job.id, job);
  }

  // Three-color DFS: 0=white (unvisited), 1=gray (visiting), 2=black (visited)
  const color = new Map<string, number>();
  const path: string[] = [];

  for (const job of jobInfos) {
    color.set(job.id, 0);
  }

  function dfs(node: string): void {
    color.set(node, 1); // gray
    path.push(node);

    const job = jobMap.get(node);
    if (job === undefined) return;

    for (const need of job.needs) {
      const needColor = color.get(need);
      if (needColor === 1) {
        // Back edge found - cycle detected
        const cycleStart = path.indexOf(need);
        const cyclePath = path.slice(cycleStart).concat(need);
        throw new Error(`needs cycle detected: ${cyclePath.join(' -> ')}.`);
      } else if (needColor === 0) {
        dfs(need);
      }
    }

    path.pop();
    color.set(node, 2); // black
  }

  for (const job of jobInfos) {
    if (color.get(job.id) === 0) {
      dfs(job.id);
    }
  }
}

/**
 * Returns the ordered list of job identifiers declared in the workflow.
 *
 * This is a thin wrapper over `listJobs`, returning just the `id` field.
 * Its existence avoids a local duplication: multiple places need just the
 * job names, and a single shared implementation ensures consistency and
 * prevents drift between identical copies.
 *
 * The behavior matches `listJobs`'s error semantics: malformed workflows or
 * duplicate IDs throw rather than returning a partial or ambiguous result.
 *
 * @param workflowText - The YAML workflow text to parse.
 * @returns An array of job identifiers, ordered by declaration.
 * @throws {Error} If the workflow is malformed or contains duplicate IDs.
 */
export function getJobNames(workflowText: string): string[] {
  return listJobs(workflowText).map((job) => job.id);
}

/**
 * Represents a violation of the cancelled-propagation contract.
 *
 * The `workflow` field is the filename of the workflow that contains the
 * violation. `jobId` identifies the specific job that fails the rule check.
 * `reason` is a tagged union that distinguishes the three ways a job can
 * violate the rule:
 *
 * - `"missing-if"`: the job has an ancestor with a job-level `if:` but the
 *   job itself lacks any job-level `if:` clause.
 * - `"bad-if-prefix"`: the job has an ancestor with `if:` and defines its own
 *   `if:`, but the expression either is not wrapped in `${{ }}` or, when
 *   wrapped, does not begin with the required `!cancelled() && ` gate prefix
 *   with a non-empty right operand. Unwrapped expressions (bare scalars) are
 *   also rejected as `bad-if-prefix` violations.
 * - `"missing-needs-reference:<name>"`: the job's `if:`/`env:` values do not
 *   contain a `needs.<name>.result` reference for at least one direct need
 *   `<name>`, where `<name>` is the specific missing dependency name.
 *
 * The design scopes violations strictly to job-level clauses (`if:`/`env:`
 * values in the scannable block) and explicitly excludes comments and `run:`
 * body content, ensuring the error message points to concrete, inspectable
 * YAML structure rather than arbitrary text.
 */
export type Violation = { workflow: string; jobId: string; reason: 'missing-if' | 'bad-if-prefix' | `missing-needs-reference:${string}` };

/**
 * Checks whether jobs that depend on conditional ancestors properly propagate
 * the cancellation gate.
 *
 * This rule exists to prevent the `deploy-website` bug from recurring: that
 * job relied on implicit success-propagation instead of stating an explicit
 * `!cancelled()` gate, leaving its execution condition undocumented and
 * unenforced. Any job whose transitive ancestor set contains at least one
 * job with a job-level `if:` must itself:
 *
 * 1. Have a job-level `if:` clause,
 * 2. Have an `if:` expression that is wrapped in `${{ }}` and starts with
 *    `!cancelled() && ` with a non-empty right operand (unwrapped expressions
 *    are rejected as `bad-if-prefix` violations), and
 * 3. Reference `needs.<name>.result` for every direct dependency in its own
 *    `if:` or `env:` values. A value may contain more than one `${{ ... }}`
 *    segment (e.g. `${{ github.event_name }}-${{ needs.a.result }}`); every
 *    segment in the value is checked independently, and the reference must
 *    match as a whole word inside one of them (word boundaries on both
 *    sides, so neither `needs.a.resultExtra` nor `xneeds.a.result` count).
 *    Text outside every `${{ ... }}` segment of the same value never counts,
 *    even on the same line as a real segment.
 *
 * The rule applies only to jobs with at least one ancestor that has an
 * explicit `if:`. Jobs like `docs.yml`'s `deploy`, whose sole ancestor `build`
 * has no job-level `if:`, are exempt from this rule entirely.
 *
 * Internally, this function builds a dependency graph from each job's `needs`
 * and computes the ancestor closure via DFS. It also performs cycle detection
 * (throwing `needs cycle detected: <path>` for cyclic dependencies) before
 * evaluating the per-job rule.
 *
 * A critical design constraint: only the `if:` and `env:` *value* lines in
 * the scannable (comment-stripped) block are examined. Comment lines, `run:`
 * body content, and other text are never scanned. This prevents false
 * positives where a `needs.<name>.result` substring appears only in a comment
 * or script output. The scope is precisely `if:`/`env:` value portions at job
 * and step levels, which is how `release-complete` satisfies the rule via its
 * step-level `env:` entries.
 *
 * The cancellation prefix check follows this exact algorithm:
 * - If the `if:` value does not start with `${{` and end with `}}`, the job
 *   immediately fails as `bad-if-prefix` — an unwrapped (bare) `if:` is
 *   always a violation for a job this rule covers, regardless of its text,
 *   even if that text would otherwise satisfy the prefix check below.
 * - Otherwise, strip those three-character markers from each end and trim
 *   whitespace from both ends to obtain the *inner expression*.
 * - The job passes only if the inner expression, compared as a string, starts
 *   with exactly `!cancelled() && ` (case-sensitive, one literal space on
 *   each side of `&&`, and the prefix must be followed by at least one
 *   non-whitespace character — an inner expression equal to exactly
 *   `!cancelled()` with nothing after it is a violation).
 * - Expressions starting with `always()` or `success()` fail trivially because
 *   they do not share that prefix.
 *
 * A multi-line (`if: >` / `if: |`) job-level `if:` is a parse error only for
 * a job this function evaluates (i.e., one with at least one ancestor that
 * has a job-level `if:`). For such jobs, `listJobs` returns the raw folded
 * marker (`">"` or `"|"`) as that job's `ifExpr` without further validation;
 * `checkCancelledPropagation` throws `Folded if: is not supported in job
 * "<id>".` when it encounters a folded scalar in a job it evaluates.
 *
 * The returned violations array is empty if and only if every job in the
 * workflow either has no conditional ancestors or fully complies with the
 * three conditions above.
 *
 * @param workflowText - The YAML workflow text to analyze.
 * @param workflowLabel - The filename identifier for violation reports.
 * @returns An array of violations, empty if all jobs comply with the rule.
 * @throws {Error} If a needs cycle is detected in the workflow dependency graph,
 *   or if a folded block scalar is encountered in a job this function evaluates.
 */
export function checkCancelledPropagation(workflowText: string, workflowLabel: string): Violation[] {
  const jobInfos = listJobs(workflowText);
  const jobMap = new Map<string, JobInfo>();
  for (const job of jobInfos) {
    jobMap.set(job.id, job);
  }

  // Compute ancestor closure for each job using BFS
  const ancestorMap = new Map<string, Set<string>>();
  for (const job of jobInfos) {
    const ancestors = new Set<string>();
    const queue: string[] = [...job.needs];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!ancestors.has(current)) {
        ancestors.add(current);
        const parent = jobMap.get(current);
        if (parent !== undefined) {
          queue.push(...parent.needs);
        }
      }
    }
    ancestorMap.set(job.id, ancestors);
  }

  const violations: Violation[] = [];

  for (const job of jobInfos) {
    const ancestors = ancestorMap.get(job.id)!;
    // Check if any ancestor has a job-level if:
    const hasConditionalAncestor = [...ancestors].some((ancId) => {
      const ancestor = jobMap.get(ancId);
      return ancestor !== undefined && ancestor.ifExpr !== undefined;
    });

    if (!hasConditionalAncestor) {
      // Exempt from the rule
      continue;
    }

    // Condition 1: job itself must have a job-level if:
    if (job.ifExpr === undefined) {
      violations.push({ workflow: workflowLabel, jobId: job.id, reason: 'missing-if' });
      continue;
    }

    // These three checks run in this order because each guards the next: a
    // folded if: is only an error once the job is known to be subject to
    // this rule (exemption was already decided above, via the ancestor set,
    // not inside listJobs); the ${{ }} wrapper must be present before an
    // inner expression can be sliced out at all; and only then is the
    // literal gate-prefix text compared.
    if (job.ifExpr.startsWith('>') || job.ifExpr.startsWith('|')) {
      throw new Error(`Folded if: is not supported in job "${job.id}".`);
    }

    if (!job.ifExpr.startsWith('${{') || !job.ifExpr.endsWith('}}')) {
      violations.push({ workflow: workflowLabel, jobId: job.id, reason: 'bad-if-prefix' });
      continue;
    }

    const innerExpr = job.ifExpr.slice(3, -2).trim();
    const gatePrefix = '!cancelled() && ';
    if (!innerExpr.startsWith(gatePrefix) || innerExpr.slice(gatePrefix.length).trim() === '') {
      violations.push({ workflow: workflowLabel, jobId: job.id, reason: 'bad-if-prefix' });
      continue;
    }

    // Condition 3: every direct need must have needs.<name>.result in if:/env: values
    const scannableLines = getScannableJobLines(workflowText, job.id);
    const ifEnvValues = collectIfEnvValues(scannableLines);

    let missingReference: string | undefined;
    for (const need of job.needs) {
      const found = ifEnvValues.some((value) => containsNeedsResultReference(value, need));
      if (!found) {
        missingReference = need;
        break;
      }
    }

    if (missingReference !== undefined) {
      violations.push({ workflow: workflowLabel, jobId: job.id, reason: `missing-needs-reference:${missingReference}` });
    }
  }

  return violations;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks whether `value` contains a whole-word `needs.<name>.result`
 * reference inside at least one `${{ ... }}` expression segment of `value`.
 * Every segment is checked independently; text outside every segment never
 * counts, even on the same line as a real segment. A quoted string literal
 * inside a segment (`'...'` or `"..."`) may itself contain `}` without
 * ending the segment early.
 */
function containsNeedsResultReference(value: string, name: string): boolean {
  const pattern = new RegExp(`\\bneeds\\.${escapeRegExp(name)}\\.result\\b`);
  for (const match of value.matchAll(/\$\{\{((?:'[^']*'|"[^"]*"|[^}])*)\}\}/g)) {
    if (pattern.test(match[1]!)) return true;
  }
  return false;
}

/**
 * Collects expression-bearing values within the job and actual step blocks.
 * The shared step splitter prevents similarly indented service configuration
 * from satisfying a dependency-result reference.
 */
function collectIfEnvValues(lines: string[]): string[] {
  const values: string[] = [];
  const stepsIndex = lines.indexOf('    steps:');
  const jobLines = stepsIndex === -1 ? lines : lines.slice(0, stepsIndex);
  for (const line of jobLines) {
    const ifMatch = /^    if: (.+)$/.exec(line);
    if (ifMatch !== null) values.push(ifMatch[1]!);
  }

  function collectEnv(block: string[], heading: string, entry: RegExp): void {
    const envIndex = block.indexOf(heading);
    if (envIndex === -1) return;
    for (const line of block.slice(envIndex + 1)) {
      if (line.trim() === '') continue;
      const match = entry.exec(line);
      if (match === null) break;
      values.push(match[1]!);
    }
  }

  collectEnv(jobLines, '    env:', /^      [A-Za-z_][A-Za-z0-9_]*: (.+)$/);
  if (stepsIndex !== -1) {
    for (const step of splitStepsIntoBlocks(lines)) {
      collectEnv(step, '        env:', /^          [A-Za-z_][A-Za-z0-9_]*: (.+)$/);
    }
  }

  return values;
}
