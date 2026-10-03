import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getJobLines, getOnKeys, getScannableJobLines, readWorkflowText, splitStepsIntoBlocks } from './workflow-text.js';

const workflow = readWorkflowText(fileURLToPath(new URL('../../../.github/workflows/pr-label.yml', import.meta.url)));

describe('pr-label workflow', () => {
  it('triggers only on the four requested pull request events', () => {
    expect(getOnKeys(workflow)).toEqual(new Set(['pull_request_target']));
    expect(workflow).toMatch(/^on:\n  pull_request_target:\n    types: \[opened, edited, reopened, synchronize\]$/m);
  });

  it('grants both required permissions at the top level before jobs', () => {
    const beforeJobs = workflow.slice(0, workflow.indexOf('\njobs:'));
    expect(beforeJobs).toMatch(/^permissions:\n  pull-requests: write\n  issues: write$/m);
  });

  it('skips Dependabot at the job boundary', () => {
    expect(getJobLines(workflow, 'label')[0]).toBe('  label:');
    expect(getScannableJobLines(workflow, 'label')).toContain(
      "    if: github.event.pull_request.user.login != 'dependabot[bot]'",
    );
  });

  it('checks out the script, then runs it with every exact event input', () => {
    const steps = splitStepsIntoBlocks(getScannableJobLines(workflow, 'label'));
    expect(steps).toHaveLength(2);
    expect(steps[0]?.[0]).toMatch(/^      - uses: actions\/checkout@[0-9a-f]{40}(?: # .*)?$/);
    expect(steps[1]).toEqual([
      '      - env:',
      '          GH_TOKEN: ${{ github.token }}',
      '          PR_TITLE: ${{ github.event.pull_request.title }}',
      '          PR_NUMBER: ${{ github.event.pull_request.number }}',
      '          PR_AUTHOR: ${{ github.event.pull_request.user.login }}',
      '          PR_HAS_ASSIGNEE: ${{ github.event.pull_request.assignees[0] != null }}',
      '        run: node scripts/lib/pr-labels.mjs',
    ]);
    expect(workflow).not.toMatch(/^\s+area: /m);
  });
});
