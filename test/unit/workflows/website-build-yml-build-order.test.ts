import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { getOnKeys, getScannableJobLines, readWorkflowText, splitStepsIntoBlocks } from './workflow-text.js';

const websiteBuildWorkflow = readWorkflowText(
  fileURLToPath(new URL('../../../.github/workflows/website-build.yml', import.meta.url)),
);

function runStepIndex(command: string, workingDirectory: string): number {
  return splitStepsIntoBlocks(getScannableJobLines(websiteBuildWorkflow, 'build')).findIndex((block) => (
    block.some((line) => line === `      - run: ${command}`)
    && (block.find((line) => line.startsWith('        working-directory: '))
      ?.slice('        working-directory: '.length) ?? 'root') === workingDirectory
  ));
}

describe('website-build workflow build ordering', () => {
  it('accepts only reusable-workflow calls and builds root artifacts before website artifacts', () => {
    expect(getOnKeys(websiteBuildWorkflow)).toEqual(new Set(['workflow_call']));

    const rootInstall = runStepIndex('npm ci', 'root');
    const rootBuild = runStepIndex('npm run build', 'root');
    const websiteInstall = runStepIndex('npm ci', 'website');
    const websiteBuild = runStepIndex('npm run build', 'website');

    expect(rootInstall).toBeGreaterThanOrEqual(0);
    expect(rootBuild).toBeGreaterThanOrEqual(0);
    expect(websiteInstall).toBeGreaterThanOrEqual(0);
    expect(websiteBuild).toBeGreaterThanOrEqual(0);
    expect(rootInstall).toBeLessThan(rootBuild);
    expect(rootBuild).toBeLessThan(websiteInstall);
    expect(websiteInstall).toBeLessThan(websiteBuild);
  });
});
