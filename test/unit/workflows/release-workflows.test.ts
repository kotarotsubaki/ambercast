import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  getJobLines,
  getOnKeys,
  getScannableJobLines,
  readWorkflowText,
  splitStepsIntoBlocks,
} from './workflow-text.js';

const docsWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/docs.yml', import.meta.url)));
const releaseWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/release-please.yml', import.meta.url)));
const websiteBuildWorkflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/website-build.yml', import.meta.url)));
const deployPagesRef = 'actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346';

function jobNames(workflowText: string): string[] {
  const lines = workflowText.split('\n');
  const jobsIndex = lines.findIndex((line) => line === 'jobs:');
  if (jobsIndex === -1) throw new Error('Workflow has no jobs: block.');
  return lines.slice(jobsIndex + 1)
    .map((line) => /^  ([a-z][a-z0-9-]*):$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
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
  it('TEST-2: defines the website build as the pinned ten-step reusable workflow', () => {
    const websiteBuildLines = websiteBuildWorkflow.split('\n');
    const workflowCallIndex = websiteBuildLines.findIndex((line) => line === '  workflow_call:');
    expect(workflowCallIndex).toBeGreaterThanOrEqual(0);
    expect(websiteBuildLines.slice(workflowCallIndex + 1, workflowCallIndex + 3)).not.toEqual(
      expect.arrayContaining(['    inputs:', '    secrets:']),
    );
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
    expect(jobNames(releaseWorkflow)).toEqual(['release-please', 'publish', 'build-website', 'deploy-website']);
    const build = getScannableJobLines(releaseWorkflow, 'build-website');
    const deploy = getScannableJobLines(releaseWorkflow, 'deploy-website');
    expect(build).toEqual(expect.arrayContaining([
      '    needs: [release-please, publish]', '    if: ${{ needs.release-please.outputs.release_created }}',
      '      contents: read', '    uses: ./.github/workflows/website-build.yml',
    ]));
    expect(build).not.toContain('    steps:');
    expect(deploy).toEqual(expect.arrayContaining([
      '    needs: build-website', '    runs-on: ubuntu-latest', '      pages: write', '      id-token: write',
      '      name: github-pages', '      url: ${{ steps.deployment.outputs.page_url }}',
      '      group: pages', '      cancel-in-progress: false',
    ]));
    expect(deploy.some((line) => line.startsWith('    if:'))).toBe(false);
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
          token: \${{ secrets.GITHUB_TOKEN }}

  # Publishing runs as a follow-up job here (not on release.published):
  # releases created with GITHUB_TOKEN intentionally do not trigger other
  # workflows, so a separate release-triggered workflow would never fire.`);
    expect(getJobLines(releaseWorkflow, 'publish').join('\n')).toBe(`  publish:
    needs: release-please
    if: \${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      # OIDC trusted publishing: npm authenticates this workflow directly,
      # no NPM_TOKEN secret is stored anywhere.
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
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
      - run: npm publish`);
  });

  it('TEST-8: relies on ordinary needs propagation for release website jobs', () => {
    const combined = [
      ...getScannableJobLines(releaseWorkflow, 'build-website'),
      ...getScannableJobLines(releaseWorkflow, 'deploy-website'),
    ];
    for (const forbidden of ['always()', 'continue-on-error', 'failure()', 'cancelled()']) {
      expect(combined.join('\n')).not.toContain(forbidden);
    }
    expect(combined.filter((line) => line.startsWith('    if:'))).toEqual([
      '    if: ${{ needs.release-please.outputs.release_created }}',
    ]);
  });

  it('TEST-9: gives every Pages deployment the shared non-cancelling concurrency policy', () => {
    const deployments = [docsWorkflow, releaseWorkflow].flatMap((workflow) => jobNames(workflow)
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
    expect(() => getJobLines(noJobsFixture, 'build')).toThrow('Workflow has no jobs: block.');
    expect(() => getScannableJobLines(noJobsFixture, 'build')).toThrow('Workflow has no jobs: block.');

    const unknownJobFixture = 'on:\n  workflow_dispatch:\njobs:\n  present:\n    runs-on: ubuntu-latest\n';
    expect(() => getJobLines(unknownJobFixture, 'absent')).toThrow('Job "absent" was not found after jobs:.');
    expect(() => splitStepsIntoBlocks(['  build:', '    runs-on: ubuntu-latest'])).toThrow('Job has no steps: section.');
  });
});
