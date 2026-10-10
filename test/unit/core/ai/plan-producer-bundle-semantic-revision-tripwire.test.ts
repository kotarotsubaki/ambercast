import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAN_PRODUCER_SEMANTIC_REVISIONS } from '#core/ai/plan-producer-bundle.js';

const INSTRUCTION_COVERAGE_POLICY_FILE = fileURLToPath(new URL('../../../../src/usecases/instruction-coverage-policy.ts', import.meta.url));
const GENERATOR_SECRET_POLICY_FILE = fileURLToPath(new URL('../../../../src/usecases/generator-secret-policy.ts', import.meta.url));

// Producer-bundle revisions can advance independently of this policy file's bytes because instruction-coverage semantics also reside in prompt-layer inputs such as the generator template.
const INSTRUCTION_COVERAGE_POLICY_PIN = { revision: 3, sourceSha256: '48f772723737653e78e857252ad69cfa4cedd536c61e88e3c38efa95633761ae' } as const;
// The source hash covers offset-ordered candidate-list resolution and diagnostic step-identity plumbing; the semantic revision reflects the policy's changed behavior.
const GENERATOR_SECRET_POLICY_PIN = { revision: 5, sourceSha256: '0178e95b566bef157d5f04ae0349af27412d6d66658a38137c1f51657d845840' } as const;

async function sha256File(fileName: string): Promise<string> {
  return createHash('sha256').update(await readFile(fileName)).digest('hex');
}

describe('producer semantic revision tripwires', () => {
  it('couples instruction-coverage policy source changes to its live semantic revision', async () => {
    expect({
      revision: PLAN_PRODUCER_SEMANTIC_REVISIONS.instructionCoveragePolicy,
      sourceSha256: await sha256File(INSTRUCTION_COVERAGE_POLICY_FILE),
    }).toEqual(INSTRUCTION_COVERAGE_POLICY_PIN);
  });

  it('couples generator-secret policy source changes to its live semantic revision', async () => {
    expect({
      revision: PLAN_PRODUCER_SEMANTIC_REVISIONS.generatorSecretPolicy,
      sourceSha256: await sha256File(GENERATOR_SECRET_POLICY_FILE),
    }).toEqual(GENERATOR_SECRET_POLICY_PIN);
  });
});
