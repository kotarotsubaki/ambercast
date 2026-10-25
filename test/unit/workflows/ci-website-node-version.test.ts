import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getScannableJobLines, readWorkflowText, splitStepsIntoBlocks } from './workflow-text.js';

/*
 * Contract: the `website` job in ci.yml validates the site on the same Node
 * version that website-build.yml builds and deploys it with. Astro refuses to
 * run on a Node older than its supported floor, so a CI job pinned to an older
 * version either blocks dependency updates (#640) or, worse, validates a build
 * that never ships.
 */

const ciWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)));
const websiteBuildWorkflow = readWorkflowText(
  fileURLToPath(new URL('../../../.github/workflows/website-build.yml', import.meta.url)),
);

type SetupNodeStep = { version: string; conditional: boolean };

/**
 * Reads a YAML scalar from the value part of a `key: value` line.
 *
 * The grammar is deliberately narrow: a plain scalar loses a trailing
 * `# comment`, a quoted scalar is the text up to its matching quote. Anything
 * the narrow grammar cannot explain (an unterminated quote, text after the
 * closing quote, a block scalar marker such as `>`) is returned verbatim
 * instead of being truncated into something that could pass for a version, so
 * the contract rejects it rather than comparing a mangled value.
 */
function parseScalar(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === "'" || quote === '"') {
    const end = value.indexOf(quote, 1);
    if (end !== -1) {
      const rest = value.slice(end + 1).trim();
      if (rest === '' || rest.startsWith('#')) {
        return value.slice(1, end);
      }
    }
    return value;
  }
  return value.replace(/\s+#.*$/, '');
}

/**
 * Collects every actions/setup-node step of one job with the Node version it
 * requests and whether the step is conditional.
 *
 * Only the step's own `with:` input counts as the pin: a `node-version` key
 * under `env:` or anywhere else in the step never satisfies it, because only
 * the action input reaches the runner. A setup-node step with no such input
 * yields an empty version so a missing pin shows up as a mismatch instead of
 * vanishing. Whole-line comments are ignored (the scannable view), and an
 * unknown job throws from the shared helper rather than yielding an empty
 * list that would look like "no pin".
 */
function setupNodeSteps(workflowText: string, jobName: string): SetupNodeStep[] {
  const steps: SetupNodeStep[] = [];
  for (const block of splitStepsIntoBlocks(getScannableJobLines(workflowText, jobName))) {
    // The `- ` marker occupies the first key's indentation, so aligning the
    // first line makes every step key sit at the same eight-space column.
    const keys = block.map((line, index) => (index === 0 ? `        ${line.slice(8)}` : line));
    if (!keys.some((line) => line.startsWith('        uses: actions/setup-node@'))) {
      continue;
    }

    const withIndex = keys.findIndex((line) => line.trimEnd() === '        with:');
    const inputs: string[] = [];
    if (withIndex !== -1) {
      for (const line of keys.slice(withIndex + 1)) {
        if (line.trim() !== '' && !line.startsWith('         ')) {
          break;
        }
        inputs.push(line);
      }
    }
    const versionLine = inputs.find((line) => line.startsWith('          node-version:'));
    steps.push({
      version: parseScalar(versionLine?.slice('          node-version:'.length) ?? ''),
      conditional: keys.some((line) => line.startsWith('        if:')),
    });
  }
  return steps;
}

/** The Node version requested by each actions/setup-node step of one job, in step order. */
function setupNodeVersions(workflowText: string, jobName: string): string[] {
  return setupNodeSteps(workflowText, jobName).map((step) => step.version);
}

/**
 * Returns why the two workflows disagree about the website's Node version, or
 * undefined when they agree.
 *
 * Demands exactly one unconditional setup-node step in an unconditional job and
 * a literal numeric version on each side (no `${{ }}` expression, no block
 * scalar), because the contract compares one concrete pin that must actually
 * run: a matching declaration on a skipped step would leave the website lane on
 * whatever Node the runner ships. A job that legitimately moves to a matrix or
 * an alias has to update this contract consciously.
 */
function websiteNodeVersionMismatch(ciText: string, buildText: string): string | undefined {
  const sides = [
    { label: 'ci.yml website job', text: ciText, job: 'website' },
    { label: 'website-build.yml build job', text: buildText, job: 'build' },
  ];
  const versions: string[] = [];
  for (const { label, text, job } of sides) {
    if (getScannableJobLines(text, job).some((line) => line.startsWith('    if:'))) {
      return `${label} has a job-level if: condition`;
    }
    const steps = setupNodeSteps(text, job);
    const step = steps[0];
    if (steps.length !== 1 || step === undefined) {
      return `${label} must have exactly one actions/setup-node step, found ${steps.length}`;
    }
    if (step.conditional) {
      return `${label} has a conditional actions/setup-node step`;
    }
    if (!/^\d+(\.\d+)*$/.test(step.version)) {
      return `${label} must pin a literal numeric Node version, found ${JSON.stringify(step.version)}`;
    }
    versions.push(step.version);
  }
  if (versions[0] !== versions[1]) {
    return `ci.yml website job uses Node ${versions[0]} but website-build.yml build job uses Node ${versions[1]}`;
  }
  return undefined;
}

const checkoutStep = '      - uses: actions/checkout@abc # v7\n';

/** A setup-node step whose `with:` carries the given extra lines after the version. */
function setupNode(version: string, extraWith = ''): string {
  return `      - uses: actions/setup-node@abc # v7\n        with:\n          node-version: ${version}\n${extraWith}`;
}

/** A minimal workflow holding one job, optionally followed by a sibling job. */
function workflow(jobName: string, steps: string, jobExtra = '', siblingJob = ''): string {
  return [
    'name: fixture',
    '',
    'on:',
    '  pull_request:',
    '',
    'jobs:',
    `  ${jobName}:`,
    '    runs-on: ubuntu-latest',
    `${jobExtra}    steps:`,
    `${steps}${siblingJob}`,
  ].join('\n');
}

const websiteJob = (steps: string, jobExtra = '', siblingJob = '') => workflow('website', steps, jobExtra, siblingJob);
const buildJob = (steps: string, jobExtra = '', siblingJob = '') => workflow('build', steps, jobExtra, siblingJob);
const pinned = checkoutStep + setupNode('24.22.1');

describe('setupNodeVersions', () => {
  it.each([
    ['unquoted', '24.22.1'],
    ['single-quoted', "'24.22.1'"],
    ['double-quoted', '"24.22.1"'],
    ['unquoted with an inline comment', '24.22.1 # pinned'],
    ['single-quoted with an inline comment', "'24.22.1' # pinned"],
    ['unquoted with trailing spaces', '24.22.1   '],
  ])('reads the %s pin as the bare version', (_label, raw) => {
    expect(setupNodeVersions(websiteJob(checkoutStep + setupNode(raw)), 'website')).toEqual(['24.22.1']);
  });

  it('keeps a quoted value that contains a hash instead of truncating it into a pin', () => {
    expect(setupNodeVersions(websiteJob(setupNode("'24.22.1 # retained'")), 'website')).toEqual(['24.22.1 # retained']);
  });

  it('returns unterminated quotes and text after the closing quote verbatim', () => {
    expect(setupNodeVersions(websiteJob(setupNode("'24.22.1")), 'website')).toEqual(["'24.22.1"]);
    expect(setupNodeVersions(websiteJob(setupNode("'24.22.1' extra")), 'website')).toEqual(["'24.22.1' extra"]);
  });

  it('returns a block scalar marker verbatim so the contract can reject it', () => {
    expect(setupNodeVersions(websiteJob(setupNode('>', '            24.22.1\n')), 'website')).toEqual(['>']);
  });

  it('returns an empty list for a job without any setup-node step', () => {
    expect(setupNodeVersions(websiteJob(checkoutStep + '      - run: npm ci\n'), 'website')).toEqual([]);
  });

  it('yields an empty version for a setup-node step without a with: mapping', () => {
    expect(setupNodeVersions(websiteJob('      - uses: actions/setup-node@abc # v7\n'), 'website')).toEqual(['']);
  });

  it('yields an empty version when with: has no node-version input', () => {
    const steps = '      - uses: actions/setup-node@abc # v7\n        with:\n          cache: npm\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual(['']);
  });

  it('does not take a node-version key from env: as the action input', () => {
    const steps = '      - uses: actions/setup-node@abc # v7\n        env:\n          node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual(['']);
  });

  it('prefers the with: input when env: carries a different node-version', () => {
    const steps = '      - uses: actions/setup-node@abc # v7\n        env:\n          node-version: 22.14\n'
      + '        with:\n          node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual(['24.22.1']);
  });

  it('does not read a node-version that sits beyond the end of the with: mapping', () => {
    const steps = '      - uses: actions/setup-node@abc # v7\n        with:\n          cache: npm\n'
      + '        env:\n          node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual(['']);
  });

  it('finds the setup-node step when uses: is not the first key of the step', () => {
    const steps = '      - name: Set up Node\n        uses: actions/setup-node@abc # v7\n        with:\n          node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual(['24.22.1']);
  });

  it('finds the setup-node step when with: is the first key of the step', () => {
    const steps = '      - with:\n          node-version: 24.22.1\n        uses: actions/setup-node@abc # v7\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual(['24.22.1']);
  });

  it('ignores a step whose action only resembles setup-node', () => {
    const steps = '      - uses: actions/setup-python@abc # v7\n        with:\n          node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(steps), 'website')).toEqual([]);
  });

  it('returns every setup-node step in step order', () => {
    expect(setupNodeVersions(websiteJob(setupNode('22.14') + setupNode('24.22.1')), 'website')).toEqual(['22.14', '24.22.1']);
  });

  it('ignores commented-out node-version lines and commented-out steps', () => {
    const commentedLine = '      - uses: actions/setup-node@abc # v7\n        with:\n          # node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(commentedLine), 'website')).toEqual(['']);
    const commentedStep = '      # - uses: actions/setup-node@abc\n      #   with:\n      #     node-version: 24.22.1\n';
    expect(setupNodeVersions(websiteJob(commentedStep + checkoutStep), 'website')).toEqual([]);
  });

  it('does not leak a sibling job\'s setup-node step into the requested job', () => {
    const sibling = `  lint:\n    runs-on: ubuntu-latest\n    steps:\n${setupNode('22.14')}`;
    expect(setupNodeVersions(websiteJob(checkoutStep, '', sibling), 'website')).toEqual([]);
    expect(setupNodeVersions(websiteJob(checkoutStep, '', sibling), 'lint')).toEqual(['22.14']);
  });

  it('reads a CRLF workflow the same way as an LF one', () => {
    expect(setupNodeVersions(websiteJob(pinned).replaceAll('\n', '\r\n'), 'website')).toEqual(['24.22.1']);
  });

  it('throws for a job the workflow does not define', () => {
    expect(() => setupNodeVersions(websiteJob(pinned), 'build')).toThrow(/"build" was not found/);
  });
});

describe('websiteNodeVersionMismatch', () => {
  it('accepts the same literal pin in both workflows', () => {
    expect(websiteNodeVersionMismatch(websiteJob(pinned), buildJob(pinned))).toBeUndefined();
  });

  it.each([
    ["single-quoted CI pin against an unquoted build pin", "'24.22.1'", '24.22.1'],
    ['double-quoted CI pin against a single-quoted build pin', '"24.22.1"', "'24.22.1'"],
    ['commented pins', '24.22.1 # a', '24.22.1 # b'],
  ])('treats %s as the same pin', (_label, ciValue, buildValue) => {
    expect(
      websiteNodeVersionMismatch(websiteJob(setupNode(ciValue)), buildJob(setupNode(buildValue))),
    ).toBeUndefined();
  });

  it('reports both versions when they differ', () => {
    expect(websiteNodeVersionMismatch(websiteJob(setupNode("'22.14'")), buildJob(setupNode('24.22.1')))).toBe(
      'ci.yml website job uses Node 22.14 but website-build.yml build job uses Node 24.22.1',
    );
  });

  it.each([
    ['a patch difference', '24.22.0', '24.22.1'],
    ['a partial CI pin', '24', '24.22.1'],
    ['a partial build pin', '24.22.1', '24'],
  ])('rejects %s', (_label, ciValue, buildValue) => {
    expect(websiteNodeVersionMismatch(websiteJob(setupNode(ciValue)), buildJob(setupNode(buildValue)))).toMatch(
      /uses Node .* but website-build\.yml build job uses Node /,
    );
  });

  it.each([
    ['an empty value', ''],
    ['an expression', '${{ matrix.node-version }}'],
    ['an alias', 'lts/*'],
    ['a v-prefixed version', 'v24.22.1'],
    ['a wildcard version', '24.x'],
    ['a block scalar marker', '>'],
    ['a quoted value with leftovers', "'24.22.1 # retained'"],
  ])('rejects %s even when both workflows agree on it', (_label, value) => {
    expect(websiteNodeVersionMismatch(websiteJob(setupNode(value)), buildJob(setupNode(value)))).toMatch(
      /ci\.yml website job must pin a literal numeric Node version/,
    );
  });

  it('rejects a bad build-side pin with the build job named', () => {
    expect(websiteNodeVersionMismatch(websiteJob(setupNode('24.22.1')), buildJob(setupNode('lts/*')))).toMatch(
      /website-build\.yml build job must pin a literal numeric Node version, found "lts\/\*"/,
    );
  });

  it('rejects block scalars whose bodies differ behind the same marker', () => {
    const ci = websiteJob(setupNode('>', '            22.14\n'));
    const build = buildJob(setupNode('>', '            24.22.1\n'));
    expect(websiteNodeVersionMismatch(ci, build)).toMatch(/must pin a literal numeric Node version, found ">"/);
  });

  it('rejects a website job without a setup-node step', () => {
    expect(websiteNodeVersionMismatch(websiteJob(checkoutStep), buildJob(pinned))).toBe(
      'ci.yml website job must have exactly one actions/setup-node step, found 0',
    );
  });

  it('rejects a build job without a setup-node step', () => {
    expect(websiteNodeVersionMismatch(websiteJob(pinned), buildJob(checkoutStep))).toBe(
      'website-build.yml build job must have exactly one actions/setup-node step, found 0',
    );
  });

  it('rejects a second setup-node step because the pin becomes ambiguous', () => {
    expect(websiteNodeVersionMismatch(websiteJob(setupNode('24.22.1') + setupNode('22.14')), buildJob(pinned))).toBe(
      'ci.yml website job must have exactly one actions/setup-node step, found 2',
    );
  });

  it('rejects a pin that only exists under env:', () => {
    const envOnly = '      - uses: actions/setup-node@abc # v7\n        env:\n          node-version: 24.22.1\n';
    expect(websiteNodeVersionMismatch(websiteJob(envOnly), buildJob(pinned))).toMatch(
      /ci\.yml website job must pin a literal numeric Node version, found ""/,
    );
  });

  it('compares the with: input when env: disagrees with it', () => {
    const steps = '      - uses: actions/setup-node@abc # v7\n        env:\n          node-version: 22.14\n'
      + '        with:\n          node-version: 24.22.1\n';
    expect(websiteNodeVersionMismatch(websiteJob(steps), buildJob(pinned))).toBeUndefined();
  });

  it.each([
    ['if: false', '        if: false\n'],
    ['an expression condition', "        if: ${{ github.event_name == 'push' }}\n"],
  ])('rejects a setup-node step guarded by %s', (_label, condition) => {
    const guarded = setupNode('24.22.1', condition);
    expect(websiteNodeVersionMismatch(websiteJob(guarded), buildJob(pinned))).toBe(
      'ci.yml website job has a conditional actions/setup-node step',
    );
  });

  it('rejects a step-level if: written as the first key of the step', () => {
    const guarded = '      - if: false\n        uses: actions/setup-node@abc # v7\n        with:\n          node-version: 24.22.1\n';
    expect(websiteNodeVersionMismatch(websiteJob(guarded), buildJob(pinned))).toBe(
      'ci.yml website job has a conditional actions/setup-node step',
    );
  });

  it('rejects a job-level if: on either side', () => {
    expect(websiteNodeVersionMismatch(websiteJob(pinned, '    if: false\n'), buildJob(pinned))).toBe(
      'ci.yml website job has a job-level if: condition',
    );
    expect(websiteNodeVersionMismatch(websiteJob(pinned), buildJob(pinned, '    if: false\n'))).toBe(
      'website-build.yml build job has a job-level if: condition',
    );
  });

  it('ignores an if: that is commented out', () => {
    const steps = checkoutStep + setupNode('24.22.1', '        # if: false\n');
    expect(websiteNodeVersionMismatch(websiteJob(steps, '    # if: false\n'), buildJob(pinned))).toBeUndefined();
  });

  it('is not fooled by a sibling job pinned to the matching version', () => {
    const sibling = `  lint:\n    runs-on: ubuntu-latest\n    steps:\n${setupNode('24.22.1')}`;
    expect(websiteNodeVersionMismatch(websiteJob(checkoutStep, '', sibling), buildJob(pinned))).toBe(
      'ci.yml website job must have exactly one actions/setup-node step, found 0',
    );
  });

  it('throws when a workflow lacks the job the contract names', () => {
    expect(() => websiteNodeVersionMismatch(buildJob(pinned), buildJob(pinned))).toThrow(/"website" was not found/);
    expect(() => websiteNodeVersionMismatch(websiteJob(pinned), websiteJob(pinned))).toThrow(/"build" was not found/);
  });
});

describe('website Node version contract', () => {
  it('pins the website CI job to the Node version website-build.yml builds with', () => {
    expect(websiteNodeVersionMismatch(ciWorkflow, websiteBuildWorkflow)).toBeUndefined();
  });

  it('keeps the CLI Node floor in the build-test matrix', () => {
    expect(getScannableJobLines(ciWorkflow, 'build-test')).toContain("        node-version: ['22.14', '24']");
  });
});
