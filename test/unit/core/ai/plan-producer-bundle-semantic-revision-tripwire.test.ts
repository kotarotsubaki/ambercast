import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAN_PRODUCER_SEMANTIC_REVISIONS } from '#core/ai/plan-producer-bundle.js';

const INSTRUCTION_COVERAGE_POLICY_FILE = fileURLToPath(new URL('../../../../src/usecases/instruction-coverage-policy.ts', import.meta.url));
const GENERATOR_SECRET_POLICY_FILE = fileURLToPath(new URL('../../../../src/usecases/generator-secret-policy.ts', import.meta.url));

// Producer-bundle revisions can advance independently of this policy file's bytes because instruction-coverage semantics also reside in prompt-layer inputs such as the generator template.
const INSTRUCTION_COVERAGE_POLICY_PIN = { revision: 2, sourceSha256: '48c3c3b1c35bc66f16bf6535e93dd5a76de94634514f7b719f94126687f13de6' } as const;
// The source hash covers diagnostic step-identity plumbing in the thrown error; that plumbing leaves citation and grant acceptance decisions—and therefore policy semantics—unchanged, so the semantic revision remains unchanged.
const GENERATOR_SECRET_POLICY_PIN = { revision: 3, sourceSha256: '1f2735b465309d4014a46c2b05ec55d5ea2186430288305f002d91cf13770587' } as const;

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
