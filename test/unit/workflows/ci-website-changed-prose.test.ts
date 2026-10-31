import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getJobLines, getOnKeys, getScannableJobLines, readWorkflowText, splitStepsIntoBlocks } from './workflow-text.js';

/*
 * Contract: CI checks new prose errors against the pull request's base with
 * complete history and an unconditional, blocking website gate (#655, #658).
 * Missing history must fail visibly, and neither skipped checks nor misplaced
 * declarations may let a pull request introduce prose errors unnoticed.
 */
const ciWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)));
const command = 'npm run check:changed -- --base "origin/${GITHUB_BASE_REF}"';
const gate = `      - run: ${command}\n        working-directory: website\n`;
const check = '      - run: npm run check\n        working-directory: website\n';
const build = '      - run: npm run build\n        working-directory: website\n';
const depth = '          fetch-depth: 0\n';

function stepKeys(block: string[]): string[] {
  return block.map((line, index) => index === 0 ? `        ${line.slice(8)}` : line);
}

function withInputs(keys: string[]): string[] {
  const start = keys.indexOf('        with:');
  if (start === -1) return [];
  const inputs: string[] = [];
  for (const line of keys.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith('         ')) break;
    inputs.push(line);
  }
  return inputs;
}

function triggerViolations(text: string): string[] {
  const triggers = getOnKeys(text);
  if (triggers.size !== 1 || !triggers.has('pull_request')) return ['CI must run only on pull_request'];
  const onBlock = text.split('on:\n')[1]!.split(/\n(?=\S)/)[0]!;
  const declarations = onBlock.split('\n').filter((line) => line.trim() && !/^\s*#/.test(line));
  return declarations.length === 1 && /^  pull_request:\s*(?:#.*)?$/.test(declarations[0]!)
    ? [] : ['pull_request must have no sub-keys'];
}

function checkoutViolations(text: string): string[] {
  const steps = splitStepsIntoBlocks(getScannableJobLines(text, 'website')).map(stepKeys);
  const checkouts = steps.filter((keys) => keys.some((line) => line.startsWith('        uses: actions/checkout@')));
  if (checkouts.length !== 1) return ['website must have exactly one checkout step'];
  const inputs = withInputs(checkouts[0]!);
  const violations: string[] = [];
  if (checkouts[0]!.some((line) => line.startsWith('        if:'))) {
    violations.push('website checkout must not have step-level if:');
  }
  if (!inputs.some((line) => /^          fetch-depth: (?:0|'0'|"0")\s*(?:#.*)?$/.test(line))) {
    violations.push('website checkout must set fetch-depth: 0 under with:');
  }
  if (!inputs.some((line) => /^          persist-credentials: false\s*(?:#.*)?$/.test(line))) {
    violations.push('website checkout must retain persist-credentials: false');
  }
  return violations;
}

function gateViolations(text: string): string[] {
  const lines = getScannableJobLines(text, 'website');
  const steps = splitStepsIntoBlocks(lines).map(stepKeys);
  const violations: string[] = [];
  for (const key of ['if', 'continue-on-error']) {
    if (lines.some((line) => line.startsWith(`    ${key}:`))) violations.push(`website must not have job-level ${key}:`);
  }
  const gates = steps.filter((keys) => keys.includes(`        run: ${command}`));
  if (gates.length !== 1) return [...violations, 'website must have exactly one exact check:changed gate'];
  const keys = gates[0]!;
  if (!keys.includes('        working-directory: website')) violations.push('check:changed must run in website');
  for (const key of ['if', 'continue-on-error']) {
    if (keys.some((line) => line.startsWith(`        ${key}:`))) violations.push(`check:changed must not have step-level ${key}:`);
  }
  const anchors = ['check', 'build'].map((name) => steps.filter((step) =>
    step.includes(`        run: npm run ${name}`) && step.includes('        working-directory: website')));
  for (const [index, name] of ['check', 'build'].entries()) {
    if (anchors[index]!.length !== 1) violations.push(`website must have exactly one npm run ${name} anchor`);
  }
  // Anchor existence precedes index arithmetic so a missing step cannot pass
  // through the sentinel index returned by indexOf.
  if (anchors.every((anchor) => anchor.length === 1)) {
    const gateIndex = steps.indexOf(keys);
    if (gateIndex !== steps.indexOf(anchors[0]![0]!) + 1) violations.push('check:changed must immediately follow website check');
    if (gateIndex >= steps.indexOf(anchors[1]![0]!)) violations.push('check:changed must precede website build');
  }
  return violations;
}

function changeWebsite(text: string, transform: (job: string) => string, allowUnchanged = false): string {
  const job = getJobLines(text, 'website').join('\n');
  const changed = transform(job);
  if (!allowUnchanged) expect(changed, 'The fixture must change the website job').not.toBe(job);
  return text.replace(job, changed);
}

// A complete baseline lets each mutation isolate exactly one contract violation.
const complete = changeWebsite(ciWorkflow, (job) => {
  let result = job.replace(/^          fetch-depth: (?:0|'0'|"0")[ \t]*(?:#.*)?$/m, depth.trimEnd());
  if (!checkoutViolations(ciWorkflow).every((message) => !message.includes('fetch-depth'))) {
    result = result.replace('          persist-credentials: false\n', `          persist-credentials: false\n${depth}`);
  }
  if (!result.includes(`      - run: ${command}\n`)) result = result.replace(build, gate + build);
  return result;
}, true);

describe('website changed-prose CI contract', () => {
  it('runs only on pull requests', () => expect(triggerViolations(ciWorkflow)).toEqual([]));
  it('fetches complete history without persisted credentials', () => expect(checkoutViolations(ciWorkflow)).toEqual([]));
  it('runs the blocking gate immediately after check and before build', () => expect(gateViolations(ciWorkflow)).toEqual([]));

  it('rejects a push trigger', () => {
    const mutated = complete.replace('on:\n', 'on:\n  push:\n');
    expect(mutated).not.toBe(complete);
    expect(triggerViolations(mutated)).toEqual(['CI must run only on pull_request']);
  });

  it.each(['paths', 'paths-ignore', 'branches', 'branches-ignore', 'types', 'unknown-filter'])('rejects pull_request %s', (key) => {
    const mutated = complete.replace('  pull_request:\n', `  pull_request:\n    ${key}: [example]\n`);
    expect(mutated).not.toBe(complete);
    expect(triggerViolations(mutated)).toEqual(['pull_request must have no sub-keys']);
  });

  it('rejects a conditional checkout', () => {
    const mutated = changeWebsite(complete, (job) => job.replace('      - uses: actions/checkout@', '      - if: false\n        uses: actions/checkout@'));
    expect(mutated).not.toBe(complete);
    expect(checkoutViolations(mutated)).toEqual(['website checkout must not have step-level if:']);
  });

  it.each(["'0'", '"0"'])('accepts fetch-depth %s', (value) => {
    const mutated = changeWebsite(complete, (job) => job.replace(depth, `          fetch-depth: ${value}\n`));
    expect(mutated).toContain(`          fetch-depth: ${value}\n`);
    expect(checkoutViolations(mutated)).toEqual([]);
  });

  it.each([
    ['missing depth', '', 'website checkout must set fetch-depth: 0 under with:'],
    ['shallow history', '          fetch-depth: 1\n', 'website checkout must set fetch-depth: 0 under with:'],
    ['depth under env', '        env:\n          fetch-depth: 0\n', 'website checkout must set fetch-depth: 0 under with:'],
    ['comment-only depth', '          # fetch-depth: 0\n', 'website checkout must set fetch-depth: 0 under with:'],
  ])('rejects %s', (_name, replacement, expected) => {
    expect(checkoutViolations(changeWebsite(complete, (job) => job.replace(depth, replacement)))).toEqual([expected]);
  });

  it('rejects a second checkout', () => {
    const checkout = splitStepsIntoBlocks(getScannableJobLines(complete, 'website'))[0]!.join('\n');
    expect(checkoutViolations(changeWebsite(complete, (job) => job.replace('    steps:\n', `    steps:\n${checkout}\n`))))
      .toEqual(['website must have exactly one checkout step']);
  });
  it('rejects persisted-credentials invariant removal', () => {
    expect(checkoutViolations(changeWebsite(complete, (job) => job.replace('          persist-credentials: false\n', ''))))
      .toEqual(['website checkout must retain persist-credentials: false']);
  });

  const exactGate = 'website must have exactly one exact check:changed gate';
  it.each([
    ['missing gate', (job: string) => job.replace(gate, ''), [exactGate]],
    ['comment-only gate', (job: string) => job.replace(gate, gate.split('\n').filter(Boolean).map((line) => `#${line}`).join('\n') + '\n'), [exactGate]],
    ['missing working directory', (job: string) => job.replace(gate, `      - run: ${command}\n`), ['check:changed must run in website']],
    ['wrong working directory', (job: string) => job.replace(gate, gate.replace('working-directory: website', 'working-directory: elsewhere')), ['check:changed must run in website']],
    ['expression base', (job: string) => job.replace(command, 'npm run check:changed -- --base "origin/${{ github.base_ref }}"'), [exactGate]],
    ['base without origin', (job: string) => job.replace(command, command.replace('origin/', '')), [exactGate]],
    ['duplicate gate', (job: string) => job.replace(gate, gate + gate), [exactGate]],
    ['step if', (job: string) => job.replace(gate, gate + '        if: false\n'), ['check:changed must not have step-level if:']],
    ...['true', 'false', '${{ always() }}'].map((value): [string, (job: string) => string, string[]] =>
      [`step continue-on-error ${value}`, (job) => job.replace(gate, gate + `        continue-on-error: ${value}\n`), ['check:changed must not have step-level continue-on-error:']]),
    ['job if', (job: string) => job.replace('  website:\n', '  website:\n    if: false\n'), ['website must not have job-level if:']],
    ...['true', 'false', '${{ always() }}'].map((value): [string, (job: string) => string, string[]] =>
      [`job continue-on-error ${value}`, (job) => job.replace('  website:\n', `  website:\n    continue-on-error: ${value}\n`), ['website must not have job-level continue-on-error:']]),
    ['missing check anchor', (job: string) => job.replace(check, ''), ['website must have exactly one npm run check anchor']],
    ['missing build anchor', (job: string) => job.replace(build, ''), ['website must have exactly one npm run build anchor']],
    ['root check anchor', (job: string) => job.replace(check, '      - run: npm run check\n'), ['website must have exactly one npm run check anchor']],
    ['inserted step', (job: string) => job.replace(gate, '      - run: echo inserted\n' + gate), ['check:changed must immediately follow website check']],
    ['gate before check', (job: string) => job.replace(gate, '').replace(check, gate + check), ['check:changed must immediately follow website check']],
    ['gate after build', (job: string) => job.replace(gate, '').replace(build, build + gate), ['check:changed must immediately follow website check', 'check:changed must precede website build']],
  ] satisfies [string, (job: string) => string, string[]][])('rejects %s', (_name, mutate, expected) => {
    expect(gateViolations(changeWebsite(complete, mutate))).toEqual(expected);
  });

  it('accepts the completed fixture', () => {
    expect([...triggerViolations(complete), ...checkoutViolations(complete), ...gateViolations(complete)]).toEqual([]);
  });
  it('throws when the website job is absent', () => {
    const mutated = complete.replace('  website:\n', '  other-website:\n');
    expect(mutated).not.toBe(complete);
    expect(() => gateViolations(mutated)).toThrow(/"website" was not found/);
  });
});
