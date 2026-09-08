import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface WorkflowStep {
  readonly run: string | null;
  readonly workingDirectory: string | null;
}

function buildJobSteps(workflow: string): readonly WorkflowStep[] {
  const lines = workflow.split('\n');
  const buildJobIndex = lines.findIndex((line) => line === '  build:');

  if (buildJobIndex === -1) {
    throw new Error('Expected .github/workflows/docs.yml to define a build job.');
  }

  const stepsIndex = lines.findIndex((line, index) => index > buildJobIndex && line === '    steps:');

  if (stepsIndex === -1) {
    throw new Error('Expected the docs build job to define steps.');
  }

  const blocks: string[][] = [];
  let currentBlock: string[] | undefined;

  for (const line of lines.slice(stepsIndex + 1)) {
    if (/^  \S/.test(line)) {
      break;
    }

    if (line.startsWith('      - ')) {
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

  return blocks.map((block) => ({
    run: block.find((line) => line.startsWith('      - run: '))?.slice('      - run: '.length) ?? null,
    workingDirectory: block.find((line) => line.startsWith('        working-directory: '))
      ?.slice('        working-directory: '.length) ?? null,
  }));
}

function runs(command: string): (step: WorkflowStep) => boolean {
  return ({ run }) => run?.split('&&').map((part) => part.trim()).includes(command) ?? false;
}

describe('docs workflow build ordering', () => {
  it('builds root generated artifacts before installing the website dependencies', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/docs.yml', import.meta.url), 'utf8');
    const steps = buildJobSteps(workflow);
    const websiteInstall = steps.findIndex((step) => (
      step.workingDirectory === 'website' && runs('npm ci')(step)
    ));
    const rootInstall = steps.findIndex((step) => (
      step.workingDirectory === null && runs('npm ci')(step)
    ));
    const rootBuild = steps.findIndex((step) => (
      step.workingDirectory === null && runs('npm run build')(step)
    ));
    const websiteBuild = steps.findIndex((step) => (
      step.workingDirectory === 'website' && runs('npm run build')(step)
    ));

    expect(websiteInstall).toBeGreaterThanOrEqual(0);
    expect(rootInstall).toBeGreaterThanOrEqual(0);
    expect(rootBuild).toBeGreaterThanOrEqual(0);
    expect(websiteBuild).toBeGreaterThanOrEqual(0);
    expect(rootInstall).toBeLessThan(rootBuild);
    expect(rootInstall).toBeLessThan(websiteInstall);
    expect(rootBuild).toBeLessThan(websiteInstall);
    expect(websiteInstall).toBeLessThan(websiteBuild);
  });
});
