import { readFileSync } from 'node:fs';

function normalizedLines(workflowText: string): string[] {
  return workflowText.replaceAll('\r', '').split('\n');
}

function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

function jobHeading(line: string): string | undefined {
  return /^  ([a-z][a-z0-9-]*):$/.exec(line)?.[1];
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
