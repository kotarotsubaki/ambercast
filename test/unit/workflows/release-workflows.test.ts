import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  getJobLines,
  getJobNames,
  getOnKeys,
  getScannableJobLines,
  listJobs,
  checkCancelledPropagation,
  readWorkflowText,
  splitStepsIntoBlocks,
} from './workflow-text.js';

const docsWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/docs.yml', import.meta.url)));
const releaseWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/release-please.yml', import.meta.url)));
const websiteBuildWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/website-build.yml', import.meta.url)));
const deployPagesRef = 'actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346';
const agentsText = readFileSync(fileURLToPath(new URL('../../../AGENTS.md', import.meta.url)), 'utf8');
const deployIf = "    if: ${{ !cancelled() && needs.build-website.result == 'success' }}";
const completeIf = "    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true')) }}";

function hasBareCancelled(lines: readonly string[]): boolean {
  return lines.some((line) => /(?<!!)cancelled\(\)/.test(line));
}

function normalizeStep(block: readonly string[]): string {
  const operations = block.flatMap((line) => {
    const uses = /^\s*- uses: (.+)$/.exec(line);
    if (uses !== null) {
      const action = uses[1];
      if (action === undefined) {
        throw new Error(`uses step has no action: ${line}`);
      }
      return [`uses:${action.split(' #', 1)[0]}`];
    }
    const run = /^\s*- run: (.+)$/.exec(line);
    if (run === null) return [];
    const command = run[1];
    if (command === undefined) {
      throw new Error(`run step has no command: ${line}`);
    }
    const directory = block.find((candidate) => candidate.startsWith('        working-directory: '))
      ?.slice('        working-directory: '.length) ?? 'root';
    return [`run:${command.trim()}@${directory}`];
  });
  expect(operations, `Expected exactly one uses: or run: operation in step:\n${block.join('\n')}`).toHaveLength(1);
  return operations[0]!;
}

function pullRequestPaths(workflowText: string): string[] {
  const lines = workflowText.split('\n');
  const trigger = lines.findIndex((line) => line === '  pull_request:');
  const paths = lines.findIndex((line, index) => index > trigger && line === '    paths:');
  if (trigger === -1 || paths === -1) throw new Error('Workflow has no pull_request paths list.');
  const result: string[] = [];
  for (const line of lines.slice(paths + 1)) {
    const match = /^      - '(.+)'$/.exec(line);
    if (match === null) break;
    const path = match[1];
    if (path === undefined) {
      throw new Error(`Workflow path entry has no path: ${line}`);
    }
    result.push(path);
  }
  return result;
}

describe('release workflows', () => {
  it('RELEASE-1: pins the deploy-website job byte for byte', () => {
    expect(getJobLines(releaseWorkflow, 'deploy-website').join('\n')).toBe([
      '  deploy-website:',
      '    needs: build-website',
      deployIf,
      '    runs-on: ubuntu-latest',
      '    permissions:',
      '      pages: write',
      '      id-token: write',
      '    environment:',
      '      name: github-pages',
      '      url: ${{ steps.deployment.outputs.page_url }}',
      '    concurrency:',
      '      group: pages',
      '      cancel-in-progress: false',
      '    steps:',
      '      - uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1',
      '        id: deployment',
    ].join('\n'));
  });

  it('RELEASE-2: pins each release gate and their shared event predicates', () => {
    const condition = (job: string) => getScannableJobLines(releaseWorkflow, job).find((line) => line.startsWith('    if:'));
    const publish = condition('publish');
    const build = condition('build-website');
    const deploy = condition('deploy-website');
    const complete = condition('release-complete');
    expect(publish).toBe("    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && needs.recover.outputs.publish_needed == 'true')) }}");
    expect(build).toBe("    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true' && needs.publish.result == 'success') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && (needs.publish.result == 'success' || (needs.publish.result == 'skipped' && needs.recover.outputs.publish_needed == 'false')))) }}");
    expect(deploy).toBe(deployIf);
    expect(complete).toBe(completeIf);
    const pushGate = "github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true'";
    const dispatchGate = "github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true'";
    for (const line of [publish, build, complete]) expect(line).toContain(pushGate);
    for (const line of [publish, build, complete]) expect(line).toContain(dispatchGate);
  });

  it('RELEASE-3: checks every repository workflow and the conditional-ancestor controls', () => {
    const workflowDirectory = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url));
    const names = readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name));
    expect(names).toContain('docs.yml');
    expect(names).toContain('release-please.yml');
    for (const name of names) {
      const violations = checkCancelledPropagation(readWorkflowText(join(workflowDirectory, name)), name);
      expect(violations, name).toEqual([]);
    }
    expect(checkCancelledPropagation(docsWorkflow, 'docs.yml').filter((item) => item.jobId === 'deploy')).toEqual([]);
    expect(getScannableJobLines(releaseWorkflow, 'publish')).toContain("        if: github.event_name == 'workflow_dispatch'");
    expect(checkCancelledPropagation(releaseWorkflow, 'release-please.yml').filter((item) => item.jobId === 'publish')).toEqual([]);
  });

  it('RELEASE-3: checks every specified malformed and valid fixture', () => {
    const a = "jobs:\n  a:\n    if: github.event_name == 'push'\n    runs-on: ubuntu-latest\n  b:\n    needs: a\n    runs-on: ubuntu-latest\n";
    const b = (body: string, first = "  a:\n    if: github.event_name == 'push'\n") => `jobs:\n${first}  b:\n${body}\n`;
    const cases: { id: string; source: string; expected?: { workflow: string; jobId: string; reason: string }[]; error?: string | RegExp; filename?: string; throwsFrom?: 'listJobs' | 'checkCancelledPropagation' }[] = [
      { id: 'a', source: a, expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-if' }] },
      { id: 'b', source: b("    needs: a\n    if: always() && needs.a.result == 'success'"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'bad-if-prefix' }] },
      { id: 'c', source: b("    needs: a\n    if: ${{ !cancelled() }}\n    env:\n      X: ${{ needs.a.result }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'bad-if-prefix' }] },
      { id: 'd', source: b("    needs: a\n    if: ${{ !cancelled() && true }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-needs-reference:a' }] },
      { id: 'e', source: b("    needs:\n      - a\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), expected: [] },
      { id: 'f', source: b("    needs: [a"), error: 'Unparseable needs: in job "b".' },
      { id: 'g', source: b("    needs: missing-job"), error: 'needs references unknown job "missing-job" from "b".' },
      { id: 'h', source: "jobs:\n  a:\n    needs: b\n  b:\n    needs: a\n", error: /needs cycle detected/ },
      { id: 'self-cycle', source: "jobs:\n  a:\n    needs: a\n", error: /needs cycle detected/ },
      { id: 'folded-if', source: b("    needs: a\n    if: >\n      !cancelled() && true"), error: 'Folded if: is not supported in job "b".', throwsFrom: 'checkCancelledPropagation' },
      { id: 'literal-if', source: b("    needs: a\n    if: |\n      !cancelled() && true"), error: 'Folded if: is not supported in job "b".', throwsFrom: 'checkCancelledPropagation' },
      { id: 'needs-folded-scalar', source: b("    needs: >\n      a\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), error: 'Unparseable needs: in job "b".' },
      { id: 'i', source: a, filename: 'fixture.yaml', expected: [{ workflow: 'fixture.yaml', jobId: 'b', reason: 'missing-if' }] },
      { id: 'j', source: a.replace('  b:', '  b_two:'), expected: [{ workflow: 'fixture.yml', jobId: 'b_two', reason: 'missing-if' }] },
      { id: 'k', source: "jobs:\n  dup:\n    runs-on: ubuntu-latest\n  dup:\n    runs-on: ubuntu-latest\n", error: 'Duplicate job id "dup".' },
      { id: 'l', source: b("    needs: [a, a]"), error: 'Duplicate needs entry "a" in job "b".' },
      { id: 'm', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    # needs.a.result\n    steps:\n      - run: echo needs.a.result"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-needs-reference:a' }] },
      { id: 'quoted', source: b("    needs: ['a']\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), expected: [] },
      { id: 'bare-quoted', source: b("    needs: 'a'\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), expected: [] },
      { id: 'block-comment', source: b("    needs:\n      - 'a' # upstream\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), expected: [] },
      { id: 'inline-comment', source: "jobs:\n  a:\n    if: github.event_name == 'push'\n  b:\n    if: github.event_name == 'push'\n  c:\n    needs: [a, b]  # fan-in\n    if: ${{ !cancelled() && needs.a.result == 'success' && needs.b.result == 'success' }}\n", expected: [] },
      { id: 'env-only', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    env:\n      X: ${{ needs.a.result }}"), expected: [] },
      { id: 'embedded-brace-in-segment', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    env:\n      X: ${{ contains(github.ref, '}') }}-${{ needs.a.result }}"), expected: [] },
      { id: 'env-value-after-blank-line', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    env:\n      UNRELATED: foo\n\n      X: ${{ needs.a.result }}"), expected: [] },
      { id: 'unconditional-ancestor', source: "jobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    needs: a\n", expected: [] },
      { id: 'invalid-id', source: "jobs:\n  bad.id:\n    runs-on: ubuntu-latest\n", error: 'Invalid job id "bad.id".' },
      { id: 'bare-followed-by-block', source: b("    needs: a\n      - a"), error: 'Unparseable needs: in job "b".' },
      { id: 'inline-trailing-text', source: b("    needs: [a] garbage"), error: 'Unparseable needs: in job "b".' },
      { id: 'block-continues-past-blank-line', source: b("    needs:\n      - a\n\n      - missing\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), error: 'needs references unknown job "missing" from "b".' },
      { id: 'embedded-colon-id', source: "jobs:\n  bad:id:\n    runs-on: ubuntu-latest\n", error: 'Invalid job id "bad:id".' },
      { id: 'missing-space-after-and', source: b("    needs: a\n    if: ${{ !cancelled() &&needs.a.result == 'success' }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'bad-if-prefix' }] },
      { id: 'services-env-is-not-step-env', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    services:\n      database:\n        env:\n          RESULT: ${{ needs.a.result }}\n    steps:\n      - run: echo ready"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-needs-reference:a' }] },
      { id: 'n', source: b("    needs:\n      - a\n\n      # between a and missing2\n      - missing2\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), error: 'needs references unknown job "missing2" from "b".' },
      { id: 'block-array-starts-after-blank-line', source: b("    needs:\n\n      # leading comment before the first item\n      - a\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), expected: [] },
      { id: 'o', source: b("    needs: a\n    needs: a\n    if: ${{ !cancelled() && needs.a.result == 'success' }}"), error: 'Duplicate needs: key in job "b".' },
      { id: 'p', source: "jobs:\n  bad:id:  # note\n    runs-on: ubuntu-latest\n", error: 'Invalid job id "bad:id".' },
      { id: 'q', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    env:\n      X: needs.a.result ${{ github.event_name }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-needs-reference:a' }] },
      { id: 'r', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    env:\n      X: ${{ needs.a.resultExtra }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-needs-reference:a' }] },
      { id: 'embedded-needs-prefix', source: b("    needs: a\n    if: ${{ !cancelled() && true }}\n    env:\n      X: ${{ xneeds.a.result }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'missing-needs-reference:a' }] },
      { id: 's', source: b("    needs: a\n    if: !cancelled() && needs.a.result == 'success'\n    env:\n      X: ${{ needs.a.result }}"), expected: [{ workflow: 'fixture.yml', jobId: 'b', reason: 'bad-if-prefix' }] },
    ];
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ambercast-release-fixtures-'));
    try {
      for (const fixture of cases) {
        const filename = fixture.filename ?? 'fixture.yml';
        const path = join(temporaryDirectory, filename);
        writeFileSync(path, fixture.source, 'utf8');
        const enumerated = readdirSync(temporaryDirectory).filter((name) => /\.ya?ml$/.test(name));
        expect(enumerated, fixture.id).toContain(filename);
        const source = readWorkflowText(path);
        if (fixture.error) expect(() => fixture.throwsFrom === 'checkCancelledPropagation' ? checkCancelledPropagation(source, filename) : listJobs(source), fixture.id).toThrow(fixture.error);
        else expect(checkCancelledPropagation(source, filename), fixture.id).toEqual(fixture.expected);
        rmSync(path);
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    expect(getJobNames('jobs:\n  build:  # note\n    runs-on: ubuntu-latest\n')).toEqual(['build']);
    expect(checkCancelledPropagation('jobs:\n  build:  # note\n    runs-on: ubuntu-latest\n', 'fixture.yml')).toEqual([]);

    expect(listJobs('jobs:\n  a:\n    needs: []\n    runs-on: ubuntu-latest\n')).toEqual([{ id: 'a', needs: [] }]);
    expect(checkCancelledPropagation('jobs:\n  a:\n    needs: []\n    runs-on: ubuntu-latest\n', 'fixture.yml')).toEqual([]);

    expect(listJobs('jobs:\n  a:\n    if: >\n      true\n    runs-on: ubuntu-latest\n')).toEqual([{ id: 'a', ifExpr: '>', needs: [] }]);
    expect(checkCancelledPropagation('jobs:\n  a:\n    if: >\n      true\n    runs-on: ubuntu-latest\n', 'fixture.yml')).toEqual([]);

    expect(checkCancelledPropagation("jobs:\n  a:\n    if: >\n      true\n  b:\n    needs: a\n    if: ${{ !cancelled() && needs.a.result == 'success' }}\n", 'fixture.yml')).toEqual([]);
  });

  it('RELEASE-4: pins the release-complete job shape and step environment', () => {
    const job = getJobLines(releaseWorkflow, 'release-complete');
    expect(job.slice(0, 6)).toEqual([
      '  release-complete:',
      '    needs: [release-please, recover, publish, build-website, deploy-website]',
      '    runs-on: ubuntu-latest',
      '    permissions: {}',
      completeIf,
      '    steps:',
    ]);
    const scannable = getScannableJobLines(releaseWorkflow, 'release-complete');
    const steps = splitStepsIntoBlocks(scannable);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(expect.arrayContaining([
      '      - run: |',
      '        env:',
      '          EVENT: ${{ github.event_name }}',
      '          PUBLISH: ${{ needs.publish.result }}',
      '          PUBLISH_NEEDED: ${{ needs.recover.outputs.publish_needed }}',
      '          BUILD: ${{ needs.build-website.result }}',
      '          DEPLOY: ${{ needs.deploy-website.result }}',
    ]));
    expect(steps[0]!.slice(steps[0]!.indexOf('        env:'))).toEqual([
      '        env:',
      '          EVENT: ${{ github.event_name }}',
      '          PUBLISH: ${{ needs.publish.result }}',
      '          PUBLISH_NEEDED: ${{ needs.recover.outputs.publish_needed }}',
      '          BUILD: ${{ needs.build-website.result }}',
      '          DEPLOY: ${{ needs.deploy-website.result }}',
    ]);
    const envIndex = steps[0]!.indexOf('        env:');
    const scriptBody = steps[0]!.slice(1, envIndex).join('\n');
    expect(scriptBody).not.toContain('${{');
  });

  it.skipIf(process.platform === 'win32').each([
    { name: 'push complete', event: 'push', publish: 'success', needed: undefined, build: 'success', deploy: 'success', exit: 0, missing: [] },
    { name: 'push skipped publish', event: 'push', publish: 'skipped', needed: undefined, build: 'success', deploy: 'success', exit: 1, missing: ['publish'] },
    { name: 'push failed publish and cancelled build', event: 'push', publish: 'failure', needed: undefined, build: 'cancelled', deploy: 'success', exit: 1, missing: ['publish', 'build-website'] },
    { name: 'dispatch permitted skipped publish', event: 'workflow_dispatch', publish: 'skipped', needed: 'false', build: 'success', deploy: 'success', exit: 0, missing: [] },
    { name: 'dispatch required skipped publish', event: 'workflow_dispatch', publish: 'skipped', needed: 'true', build: 'success', deploy: 'success', exit: 1, missing: ['publish'] },
    { name: 'dispatch missing build', event: 'workflow_dispatch', publish: 'success', needed: 'true', build: '', deploy: 'success', exit: 1, missing: ['build-website'] },
    { name: 'push skipped deploy', event: 'push', publish: 'success', needed: undefined, build: 'success', deploy: 'skipped', exit: 1, missing: ['deploy-website'] },
    { name: 'dispatch unknown deploy value', event: 'workflow_dispatch', publish: 'skipped', needed: 'false', build: 'success', deploy: 'bogus', exit: 1, missing: ['deploy-website'] },
  ])('RELEASE-4: executes the summary gate for $name', ({ event, publish, needed, build, deploy, exit, missing }) => {
    const job = getScannableJobLines(releaseWorkflow, 'release-complete');
    const start = job.indexOf('      - run: |');
    expect(start).toBeGreaterThanOrEqual(0);
    const bodyLines: string[] = [];
    for (const line of job.slice(start + 1)) {
      if (line.trim() && line.length - line.trimStart().length <= 8) break;
      bodyLines.push(line);
    }
    const first = bodyLines.find((line) => line.trim());
    expect(first).toBeDefined();
    const indent = first!.length - first!.trimStart().length;
    expect(indent).toBe(10);
    const script = bodyLines.map((line) => line.trim() ? line.slice(indent) : '').join('\n');
    expect(script).not.toBe('');
    expect(script).toContain('missing=');
    const directory = mkdtempSync(join(tmpdir(), 'ambercast-release-summary-'));
    const summary = join(directory, 'summary.txt');
    const stderrFile = join(directory, 'stderr.txt');
    try {
      writeFileSync(summary, '', 'utf8');
      writeFileSync(stderrFile, '', 'utf8');
      const env = { ...process.env, EVENT: event, PUBLISH: publish, BUILD: build, DEPLOY: deploy, GITHUB_STEP_SUMMARY: summary };
      if (needed === undefined) delete (env as Record<string, string | undefined>).PUBLISH_NEEDED;
      else (env as Record<string, string | undefined>).PUBLISH_NEEDED = needed;
      const result = spawnSync('bash', ['-e'], { input: script, env, encoding: 'utf8' });
      writeFileSync(stderrFile, result.stderr, 'utf8');
      const summaryText = readFileSync(summary, 'utf8');
      const stderrText = readFileSync(stderrFile, 'utf8');
      expect(result.status).toBe(exit);
      if (exit === 0) {
        expect(summaryText).toContain('Release complete');
        expect(stderrText).toBe('');
      } else {
        const exact = `Release incomplete:${missing.map((stage) => ` ${stage}`).join('')}`;
        expect(summaryText.trim()).toBe(exact);
        expect(stderrText.trim()).toBe(exact);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('RELEASE-6: documents recovery checks and the next push outcome', () => {
    const start = agentsText.indexOf('**Manual recovery path**:');
    const end = agentsText.indexOf('**Stacked pull requests**', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const policy = agentsText.slice(start, end);
    for (const phrase of ['release-complete', 'job summary', 'docs.yml', 'workflow run release-please.yml', 'pages', 'concurrency', 'next real release']) {
      expect(policy).toContain(phrase);
    }
    expect(policy).toMatch(/prior.*maintainer.*authoriz/i);
    expect(policy).toMatch(/manual.*docs\.yml.*dispatch/i);
    expect(policy).toMatch(/maintainer.*merges.*release PR.*confirm/i);
  });
  it('RECOVER-1: declares the exact dispatch inputs and keeps push and concurrency', () => {
    expect(getOnKeys(releaseWorkflow)).toEqual(new Set(['push', 'workflow_dispatch']));
    const lines = releaseWorkflow.split('\n');
    const onIndex = lines.indexOf('on:');
    const permissionsIndex = lines.indexOf('permissions: {}');
    expect(lines.slice(onIndex, permissionsIndex)).toEqual([
      'on:', '  push:', '    branches: [main]', '  workflow_dispatch:', '    inputs:',
      '      tag:',
      "        description: 'Release tag to recover (vX.Y.Z) — re-publishes to npm and redeploys the site at that tag when the push-triggered release run failed partway through.'",
      '        required: true', '        type: string', '      dry_run:',
      "        description: 'Verify only; do not publish or deploy.'",
      '        required: false', '        type: boolean', '        default: false', '',
    ]);
    expect(lines.slice(lines.indexOf('concurrency:'), lines.indexOf('jobs:'))).toEqual([
      'concurrency:', '  group: release-please', '  cancel-in-progress: false', '',
    ]);
    for (const job of ['release-please', 'recover', 'publish', 'deploy-website']) {
      for (const step of splitStepsIntoBlocks(getScannableJobLines(releaseWorkflow, job))) {
        if (/^\s*- run: /.test(step[0] ?? '')) {
          const metadataIndex = step.findIndex((line, index) => index > 0 && /^        [a-z-]+:/.test(line));
          const script = step.slice(0, metadataIndex === -1 ? undefined : metadataIndex);
          expect(script.join('\n'), `${job} run script`).not.toContain('${{ inputs.');
        }
      }
    }
    const checkout = splitStepsIntoBlocks(getScannableJobLines(releaseWorkflow, 'recover'))[0];
    expect(checkout).toEqual(expect.arrayContaining([
      '          fetch-depth: 0', '          fetch-tags: true', '          persist-credentials: false',
    ]));
  });

  it('RECOVER-2: gates release-please to push with the exact job text', () => {
    expect(getJobLines(releaseWorkflow, 'release-please').join('\n')).toBe(`  release-please:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
    steps:
      - uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        id: release
        with:
          token: \${{ secrets.GITHUB_TOKEN }}`);
  });

  it('RECOVER-5: exports exactly the five downstream recovery values', () => {
    const recover = getJobLines(releaseWorkflow, 'recover');
    const start = recover.indexOf('    outputs:');
    const end = recover.indexOf('    steps:');
    expect(recover.slice(start, end)).toEqual([
      '    outputs:',
      '      tag: ${{ steps.recover.outputs.tag }}',
      '      sha: ${{ steps.recover.outputs.sha }}',
      '      version: ${{ steps.recover.outputs.version }}',
      '      publish_needed: ${{ steps.recover.outputs.publish_needed }}',
      '      deploy: ${{ steps.recover.outputs.deploy }}',
    ]);
  });

  it('RECOVER-6: publishes only after the specified recovery and recheck gates', () => {
    const publish = getScannableJobLines(releaseWorkflow, 'publish');
    expect(publish).toEqual(expect.arrayContaining([
      '    needs: [release-please, recover]',
      "    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && needs.recover.outputs.publish_needed == 'true')) }}",
    ]));
    const steps = splitStepsIntoBlocks(publish);
    expect(steps[0]).toContain('          ref: ${{ needs.recover.outputs.sha }}');
    expect(steps.find((step) => step[0] === '      - run: node scripts/lib/release-recover.mjs --recheck')).toEqual([
      '      - run: node scripts/lib/release-recover.mjs --recheck',
      '        id: recheck',
      "        if: github.event_name == 'workflow_dispatch'",
      '        env:',
      '          VERSION: ${{ needs.recover.outputs.version }}',
      '          GH_TOKEN: ${{ github.token }}',
    ]);
    expect(steps.find((step) => step[0] === '      - run: npm publish')).toEqual([
      '      - run: npm publish', "        if: steps.recheck.outputs.skip != 'true'",
    ]);
  });

  it('RECOVER-7: builds from the recovered commit and retains Pages deployment', () => {
    const build = getScannableJobLines(releaseWorkflow, 'build-website');
    expect(build).toEqual(expect.arrayContaining([
      '    needs: [release-please, recover, publish]',
      "    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true' && needs.publish.result == 'success') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && (needs.publish.result == 'success' || (needs.publish.result == 'skipped' && needs.recover.outputs.publish_needed == 'false')))) }}",
      '    with:', '      ref: ${{ needs.recover.outputs.sha }}',
    ]));
    // TEST-5 also asserts deploy-website's own if: line.
  });

  it('RECOVER-8: forwards an optional ref while docs keeps its default call', () => {
    expect(getOnKeys(websiteBuildWorkflow)).toEqual(new Set(['workflow_call']));
    expect(websiteBuildWorkflow.split('\n').slice(3, 9)).toEqual([
      '  workflow_call:', '    inputs:', '      ref:', '        type: string', "        default: ''", '',
    ]);
    const checkout = splitStepsIntoBlocks(getScannableJobLines(websiteBuildWorkflow, 'build'))[0];
    expect(checkout).toContain('          ref: ${{ inputs.ref }}');
    const docsBuild = getScannableJobLines(docsWorkflow, 'build');
    expect(docsBuild).toContain('    uses: ./.github/workflows/website-build.yml');
    expect(docsBuild).not.toContain('    with:');
  });

  it('RECOVER-10: documents the manual recovery invocation beside release policy', () => {
    const start = agentsText.indexOf('**Branching & releases**:');
    const end = agentsText.indexOf('**Stacked pull requests**', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const policy = agentsText.slice(start, end);
    expect(policy).toContain('gh workflow run release-please.yml');
    expect(policy).toContain('dry_run');
    expect(policy).toContain('docs.yml');
  });

  it('TEST-2: defines the website build as the pinned ten-step reusable workflow', () => {
    const websiteBuildLines = websiteBuildWorkflow.split('\n');
    const workflowCallIndex = websiteBuildLines.findIndex((line) => line === '  workflow_call:');
    expect(workflowCallIndex).toBeGreaterThanOrEqual(0);
    expect(websiteBuildLines.slice(workflowCallIndex + 1, workflowCallIndex + 6)).toEqual([
      '    inputs:', '      ref:', '        type: string', "        default: ''", '',
    ]);
    expect(websiteBuildWorkflow).not.toContain('    secrets:');
    expect(websiteBuildWorkflow).not.toContain('github.event_name');

    const build = getScannableJobLines(websiteBuildWorkflow, 'build');
    const steps = splitStepsIntoBlocks(build);
    expect(steps.map(normalizeStep)).toEqual([
      'uses:actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      'uses:actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
      'run:npm ci@root', 'run:npm run build@root', 'run:npm ci@website',
      'run:npm run sync@website', 'run:npm run check@website', 'run:npm run build@website',
      'uses:actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d',
      'uses:actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9',
    ]);
    const checkout = steps.find((step) => normalizeStep(step).startsWith('uses:actions/checkout@'));
    const setupNode = steps.find((step) => normalizeStep(step).startsWith('uses:actions/setup-node@'));
    const upload = steps.find((step) => normalizeStep(step).startsWith('uses:actions/upload-pages-artifact@'));
    expect(checkout).toContain('          persist-credentials: false');
    expect(checkout).toContain('          ref: ${{ inputs.ref }}');
    expect(setupNode).toEqual(expect.arrayContaining([
      '          node-version: 24.18.1', '          cache: npm', '          cache-dependency-path: website/package-lock.json',
    ]));
    expect(upload).toContain('          path: website/dist');
    expect(upload?.some((line) => /^\s+name:/.test(line))).toBe(false);
    expect(build).toContain('      contents: read');
    expect(websiteBuildWorkflow.split('\n')).toContain('permissions: {}');
  });

  it('TEST-3: runs docs validation only for pull requests and manual dispatches', () => {
    expect(getOnKeys(docsWorkflow)).toEqual(new Set(['pull_request', 'workflow_dispatch']));
    const docsLines = docsWorkflow.split('\n');
    const workflowDispatchIndex = docsLines.findIndex((line) => line === '  workflow_dispatch:');
    expect(workflowDispatchIndex).toBeGreaterThanOrEqual(0);
    expect(docsLines.slice(workflowDispatchIndex + 1, workflowDispatchIndex + 3)).not.toContain('    inputs:');
    expect(pullRequestPaths(docsWorkflow)).toEqual([
      'website/**', 'docs/**', 'src/**', 'package.json', 'package-lock.json', 'tsdown.config.js',
      '.github/workflows/docs.yml', '.github/workflows/website-build.yml',
    ]);
  });

  it('TEST-4: calls the reusable builder and deploys only manual main-branch docs requests', () => {
    const build = getScannableJobLines(docsWorkflow, 'build');
    const deploy = getScannableJobLines(docsWorkflow, 'deploy');
    expect(build).toContain('    uses: ./.github/workflows/website-build.yml');
    expect(build).toContain('      contents: read');
    expect(build).not.toContain('    steps:');
    expect(build.some((line) => line.startsWith('    if:'))).toBe(false);
    expect(deploy).toEqual(expect.arrayContaining([
      '    needs: build', "    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
      '    runs-on: ubuntu-latest', '      pages: write', '      id-token: write', '      name: github-pages',
      '      url: ${{ steps.deployment.outputs.page_url }}',
      '      group: pages', '      cancel-in-progress: false',
    ]));
    const steps = splitStepsIntoBlocks(deploy);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain('        id: deployment');
    expect(normalizeStep(steps[0]!)).toBe(`uses:${deployPagesRef}`);
  });

  it('TEST-5: builds and deploys the website after a release-created publish', () => {
    expect(getJobNames(releaseWorkflow)).toEqual(['release-please', 'recover', 'publish', 'build-website', 'deploy-website', 'release-complete']);
    const build = getScannableJobLines(releaseWorkflow, 'build-website');
    const deploy = getScannableJobLines(releaseWorkflow, 'deploy-website');
    expect(build).toEqual(expect.arrayContaining([
      '    needs: [release-please, recover, publish]',
      "    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true' && needs.publish.result == 'success') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && (needs.publish.result == 'success' || (needs.publish.result == 'skipped' && needs.recover.outputs.publish_needed == 'false')))) }}",
      '      contents: read', '    uses: ./.github/workflows/website-build.yml',
      '    with:', '      ref: ${{ needs.recover.outputs.sha }}',
    ]));
    expect(build).not.toContain('    steps:');
    expect(deploy).toEqual(expect.arrayContaining([
      '    needs: build-website', '    runs-on: ubuntu-latest', '      pages: write', '      id-token: write',
      '      name: github-pages', '      url: ${{ steps.deployment.outputs.page_url }}',
      '      group: pages', '      cancel-in-progress: false',
    ]));
    expect(deploy).toContain("    if: ${{ !cancelled() && needs.build-website.result == 'success' }}");
    const steps = splitStepsIntoBlocks(deploy);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain('        id: deployment');
    expect(normalizeStep(steps[0]!)).toBe(`uses:${deployPagesRef}`);
  });

  it('TEST-6: leaves release-please triggered by every main push', () => {
    const lines = releaseWorkflow.split('\n');
    const onIndex = lines.findIndex((line) => line === 'on:');
    const end = lines.findIndex((line, index) => index > onIndex && /^\S/.test(line));
    const onBlock = lines.slice(onIndex + 1, end);
    const pushIndex = onBlock.indexOf('  push:');
    expect(pushIndex).toBeGreaterThanOrEqual(0);
    expect(onBlock.slice(pushIndex + 1)).toContain('    branches: [main]');
    expect(onBlock).not.toContain('    paths:');
  });

  it('TEST-7: keeps the release and npm publish jobs byte-stable', () => {
    expect(getJobLines(releaseWorkflow, 'release-please').join('\n')).toBe(`  release-please:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    outputs:
      release_created: \${{ steps.release.outputs.release_created }}
    steps:
      - uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0
        id: release
        with:
          token: \${{ secrets.GITHUB_TOKEN }}`);
    expect(getJobLines(releaseWorkflow, 'publish').join('\n')).toBe(`  publish:
    needs: [release-please, recover]
    if: \${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && needs.recover.outputs.publish_needed == 'true')) }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      # OIDC trusted publishing: npm authenticates this workflow directly,
      # no NPM_TOKEN secret is stored anywhere.
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: \${{ needs.recover.outputs.sha }}
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          # Node 24 LTS bundles npm >= 11.5.1, the minimum for OIDC trusted
          # publishing, so no separate npm upgrade step is needed.
          node-version: 24.18.1
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm run build
      - run: node scripts/verify-pack.mjs
      - run: node scripts/lib/release-recover.mjs --recheck
        id: recheck
        if: github.event_name == 'workflow_dispatch'
        env:
          VERSION: \${{ needs.recover.outputs.version }}
          GH_TOKEN: \${{ github.token }}
      - run: npm publish
        if: steps.recheck.outputs.skip != 'true'`);
  });

  it('TEST-8: gates both release website jobs behind !cancelled()-prefixed job-level if: expressions', () => {
    const combined = [
      ...getScannableJobLines(releaseWorkflow, 'build-website'),
      ...getScannableJobLines(releaseWorkflow, 'deploy-website'),
    ];
    for (const forbidden of ['always()', 'continue-on-error', 'failure()']) {
      expect(combined.join('\n')).not.toContain(forbidden);
    }
    expect(hasBareCancelled(combined)).toBe(false);
    expect(combined.filter((line) => line.startsWith('    if:'))).toEqual([
      "    if: ${{ !cancelled() && ((github.event_name == 'push' && needs.release-please.result == 'success' && needs.release-please.outputs.release_created == 'true' && needs.publish.result == 'success') || (github.event_name == 'workflow_dispatch' && needs.recover.result == 'success' && needs.recover.outputs.deploy == 'true' && (needs.publish.result == 'success' || (needs.publish.result == 'skipped' && needs.recover.outputs.publish_needed == 'false')))) }}",
      "    if: ${{ !cancelled() && needs.build-website.result == 'success' }}",
    ]);
  });

  it('TEST-9: gives every Pages deployment the shared non-cancelling concurrency policy', () => {
    const deployments = [docsWorkflow, releaseWorkflow].flatMap((workflow) => getJobNames(workflow)
      .map((name) => getScannableJobLines(workflow, name))
      .filter((lines) => lines.join('\n').includes('actions/deploy-pages')));
    expect(deployments).toHaveLength(2);
    for (const job of deployments) {
      expect(job).toEqual(expect.arrayContaining(['      group: pages', '      cancel-in-progress: false']));
      expect(job.some((line) => /^\s+queue:/.test(line))).toBe(false);
    }
  });

  it('TEST-10: never permits a pull-request or push deployment from docs.yml', () => {
    const condition = getScannableJobLines(docsWorkflow, 'deploy').find((line) => line.startsWith('    if: '));
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).not.toContain('pull_request');
    expect(condition).not.toContain('push');
  });

  it('TEST-11: ignores whole comment lines and scopes jobs after jobs:', () => {
    const crlfFixture = 'on:\r\n  workflow_dispatch:\r\njobs:\r\n  build:\r\n    steps:\r\n      # uses: actions/deploy-pages@fixture and always()\r\n      - run: npm ci\r\n';
    const lfFixture = crlfFixture.replaceAll('\r', '');
    const crlfScan = getScannableJobLines(crlfFixture, 'build');
    expect(getJobLines(crlfFixture, 'build')).toEqual(getJobLines(lfFixture, 'build'));
    expect(crlfScan).toEqual(getScannableJobLines(lfFixture, 'build'));
    expect(splitStepsIntoBlocks(crlfScan)).toEqual([['      - run: npm ci']]);
    expect(crlfScan.join('\n')).not.toContain('uses: actions/deploy-pages');
    expect(crlfScan.join('\n')).not.toContain('always()');

    const onPushFixture = 'on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n';
    expect(() => getJobLines(onPushFixture, 'push')).toThrow('Job "push" was not found after jobs:.');
    expect(getJobLines(onPushFixture, 'build')).toEqual(['  build:', '    runs-on: ubuntu-latest']);

    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ambercast-workflow-text-'));
    const temporaryWorkflow = join(temporaryDirectory, 'fixture.yml');
    try {
      writeFileSync(temporaryWorkflow, crlfFixture, 'utf8');
      expect(readWorkflowText(temporaryWorkflow)).not.toContain('\r');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    expect(() => getOnKeys('name: no triggers\n')).toThrow('Workflow has no on: block.');
    const noJobsFixture = 'on:\n  workflow_dispatch:\n';
    expect(() => listJobs(noJobsFixture)).toThrow('Workflow has no jobs: block.');
    expect(() => getJobLines(noJobsFixture, 'build')).toThrow('Workflow has no jobs: block.');
    expect(() => getScannableJobLines(noJobsFixture, 'build')).toThrow('Workflow has no jobs: block.');

    const unknownJobFixture = 'on:\n  workflow_dispatch:\njobs:\n  present:\n    runs-on: ubuntu-latest\n';
    expect(() => getJobLines(unknownJobFixture, 'absent')).toThrow('Job "absent" was not found after jobs:.');
    expect(() => splitStepsIntoBlocks(['  build:', '    runs-on: ubuntu-latest'])).toThrow('Job has no steps: section.');
  });
});
