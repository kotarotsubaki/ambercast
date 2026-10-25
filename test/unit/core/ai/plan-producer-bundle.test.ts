import { describe, expect, it } from 'vitest';
import { validateAiResponse } from '#adapters/ai/shared/response-validator.js';
import {
  computePlanProducerBundleFingerprint,
  liveProducerBundleInputs,
  PLAN_PRODUCER_BUNDLE_COMPONENT_NAMES,
  planProducerBundleComponentDiagnostics,
  planProducerBundleFingerprint,
  planProducerBundleManifest,
  PLAN_PRODUCER_SEMANTIC_REVISIONS,
  type PlanProducerBundleInputs,
} from '#core/ai/plan-producer-bundle.js';
import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { GeneratedPlanResponseRequest } from '#core/ir/schema.js';
import { GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE, GENERATOR_SECRET_POLICY_TEMPLATE } from '#core/ai/prompt-envelope.js';

function createInputs(overrides: Partial<PlanProducerBundleInputs> = {}): PlanProducerBundleInputs {
  return {
    generatorPromptTemplate: 'template',
    generatorTaskInstruction: 'task',
    generatedPlanResponseSchema: { type: 'object' },
    generatedPlanResponseLocalContract: { type: 'object', additionalProperties: false },
    instructionCoveragePolicyRevision: 1,
    generatorSecretPolicyRevision: 1,
    elementIntentPolicyRevision: 1,
    ...overrides,
  };
}

describe('plan producer bundle', () => {
  // TEST-G5 / SPEC-G6
  it('includes the element intent policy and its four provider rules in the live bundle', () => {
    const components = planProducerBundleComponentDiagnostics(liveProducerBundleInputs());
    expect(PLAN_PRODUCER_SEMANTIC_REVISIONS.elementIntentPolicy).toBe(1);
    expect(PLAN_PRODUCER_BUNDLE_COMPONENT_NAMES).toContain('elementIntentPolicyRevision');
    expect(components.elementIntentPolicyRevision).toBe(1);
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE).toContain('Never guess or infer an element\'s accessible role or name');
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE).toContain('exact literal text appearing inside quotation marks');
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE).toContain('as an ai step instead');
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE.endsWith("When setting confirms on an assertion or ai step, list only earlier click, press, fill, fill-secret, or capture steps whose intended effects are evidenced by the exact state it verifies. Do not exclude a step solely because it precedes a submit or another action. Include preceding fill and fill-secret steps when the verified outcome provides evidence for their intended effects; for example, a state that shows the result of signing in as the entered user evidences both the username and the password inputs, while a state that any signed-in session would show, such as a sign-out button, evidences neither. Do not infer confirmation from temporal order or general workflow dependency alone, and exclude steps whose effects the check does not verify.")).toBe(true);
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE).not.toContain('exclude earlier actions');
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE).not.toContain('list only the actions that produced the exact state');
    expect(GENERATOR_SECRET_POLICY_TEMPLATE).toContain('"intent":');
    expect(GENERATOR_SECRET_POLICY_TEMPLATE).toContain('"startAnchor":');
    // V4 producer bundle fingerprint, before the v5 element-intent contract.
    expect(planProducerBundleFingerprint()).not.toBe('2f5046995ee6207a945716030a97de787fb9baefb72fcea8bf51c4c857bdc5be');
    expect(planProducerBundleFingerprint()).not.toBe('58cb77887f52dcc20567a07d833fac28775ff41f0a57040408c7495dc9dc7c58');
  });
  it('TEST-2 preserves the three existing intent rules before the #598 evidence policy', () => {
    const existingRules = "Never guess or infer an element's accessible role or name from prior knowledge of the application; express what you observe about the element only as a source-backed intent with a description, optional roleHint, anchor coordinates, and optional literal quote, never as a resolved role/name locator. Set quote only to the exact literal text appearing inside quotation marks in the prompt itself; never paraphrase, translate, or infer it, and omit quote entirely when the prompt does not quote the relevant UI text verbatim. Express an element-visible, text-equals, or element-count assertion whose target has no verbatim quoted text in the prompt as an ai step instead.";
    expect(GENERATOR_ELEMENT_INTENT_POLICY_TEMPLATE).toBe(existingRules + ' ' + "When setting confirms on an assertion or ai step, list only earlier click, press, fill, fill-secret, or capture steps whose intended effects are evidenced by the exact state it verifies. Do not exclude a step solely because it precedes a submit or another action. Include preceding fill and fill-secret steps when the verified outcome provides evidence for their intended effects; for example, a state that shows the result of signing in as the entered user evidences both the username and the password inputs, while a state that any signed-in session would show, such as a sign-out button, evidences neither. Do not infer confirmation from temporal order or general workflow dependency alone, and exclude steps whose effects the check does not verify.");
  });
  it('returns deterministic lowercase SHA-256 hex for deep-equal inputs', () => {
    expect(computePlanProducerBundleFingerprint(createInputs())).toMatch(/^[0-9a-f]{64}$/);
    expect(computePlanProducerBundleFingerprint(createInputs())).toBe(computePlanProducerBundleFingerprint(createInputs()));
  });

  it('matches the independently derived SHA-256 oracle for a seven-field preimage', () => {
    // Recorded from the canonical seven-field JSON preimage.
    expect(computePlanProducerBundleFingerprint(createInputs())).toBe('a2f055c67e50d5ef7204708059a9f03647f64c42d0e7a125806cc25c83f643b0');
  });

  it.each(Object.entries({
    generatorPromptTemplate: (inputs: PlanProducerBundleInputs) => ({ ...inputs, generatorPromptTemplate: 'changed template' }),
    generatorTaskInstruction: (inputs: PlanProducerBundleInputs) => ({ ...inputs, generatorTaskInstruction: 'changed task' }),
    generatedPlanResponseSchema: (inputs: PlanProducerBundleInputs) => ({ ...inputs, generatedPlanResponseSchema: { type: 'array' } }),
    generatedPlanResponseLocalContract: (inputs: PlanProducerBundleInputs) => ({ ...inputs, generatedPlanResponseLocalContract: { type: 'array' } }),
    instructionCoveragePolicyRevision: (inputs: PlanProducerBundleInputs) => ({ ...inputs, instructionCoveragePolicyRevision: 2 }),
    generatorSecretPolicyRevision: (inputs: PlanProducerBundleInputs) => ({ ...inputs, generatorSecretPolicyRevision: 2 }),
    elementIntentPolicyRevision: (inputs: PlanProducerBundleInputs) => ({ ...inputs, elementIntentPolicyRevision: 2 }),
  } satisfies { [K in keyof PlanProducerBundleInputs]-?: (inputs: PlanProducerBundleInputs) => PlanProducerBundleInputs }))(
    'changes when only %s changes',
    (_field, mutate) => expect(computePlanProducerBundleFingerprint(mutate(createInputs())))
      .not.toBe(computePlanProducerBundleFingerprint(createInputs())),
  );

  it('keeps the manifest shape aligned with its exported component inventory', () => {
    expect(Object.keys(planProducerBundleManifest(createInputs())).sort())
      .toEqual([...PLAN_PRODUCER_BUNDLE_COMPONENT_NAMES].sort());
  });

  it('assembles the live fingerprint from a cold module load', () => {
    expect(planProducerBundleFingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(liveProducerBundleInputs()).toBeDefined();
    expect(liveProducerBundleInputs().generatedPlanResponseSchema).toEqual(
      typedJsonSchema(GeneratedPlanResponseRequest),
    );
  });

  it('accepts an AI step with an empty verification intent through AJV', () => {
    const response = {
      steps: [{
        id: 'complete-sign-in',
        kind: 'ai',
        target: 'web',
        instruction: 'Complete the sign-in flow.',
        instructionCoverage: [{
          id: 'submit-credentials',
          kind: 'action',
          startAnchor: 'L1',
          startColumn: 1,
          endAnchor: 'L1',
          endColumn: 24,
          citation: 'Submit the credentials.',
        }],
        verificationIntent: [],
      }],
      ambiguities: [],
    };

    const result = validateAiResponse(
      JSON.stringify(response),
      typedJsonSchema(GeneratedPlanResponseRequest),
    );

    expect(result.steps[0]?.kind).toBe('ai');
    if (result.steps[0]?.kind !== 'ai') {
      throw new Error('Expected the response to contain one AI step.');
    }
    expect(result.steps[0].verificationIntent).toEqual([]);
  });

  it('rejects an AI step with empty instruction coverage through AJV', () => {
    const response = {
      steps: [{
        id: 'complete-sign-in',
        kind: 'ai',
        instruction: 'Complete the sign-in flow.',
        instructionCoverage: [],
        verificationIntent: [{
          criterionId: 'dashboard-reached',
          assertion: { type: 'assert', check: 'text-visible', text: 'Dashboard' },
        }],
      }],
      ambiguities: [],
    };

    expect(() => validateAiResponse(
      JSON.stringify(response),
      typedJsonSchema(GeneratedPlanResponseRequest),
    )).toThrow(AiResponseInvalidError);
  });

  it('rejects an invalid non-empty verification intent element through AJV', () => {
    const response = {
      steps: [{
        id: 'complete-sign-in',
        kind: 'ai',
        instruction: 'Complete the sign-in flow.',
        instructionCoverage: [{
          id: 'some-id',
          kind: 'action',
          startAnchor: 'L1',
          startColumn: 1,
          endAnchor: 'L1',
          endColumn: 29,
          citation: 'Complete the sign-in flow.',
        }],
        verificationIntent: [{
          criterionId: 'some-id',
          assertion: { type: 'not-a-real-assertion' },
        }],
      }],
      ambiguities: [],
    };

    expect(() => validateAiResponse(
      JSON.stringify(response),
      typedJsonSchema(GeneratedPlanResponseRequest),
    )).toThrow(AiResponseInvalidError);
  });

  it('has exactly one AI-shaped request alternative without a verification intent minimum', () => {
    const schema = typedJsonSchema(GeneratedPlanResponseRequest) as unknown as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const steps = properties.steps as Record<string, unknown>;
    const items = steps.items;

    function findAiSchemas(node: unknown): Record<string, unknown>[] {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        return [];
      }

      const schemaNode = node as Record<string, unknown>;
      const matches: Record<string, unknown>[] = [];
      const nodeProperties = schemaNode.properties;
      if (
        typeof nodeProperties === 'object'
        && nodeProperties !== null
        && !Array.isArray(nodeProperties)
        && Object.hasOwn(nodeProperties, 'verificationIntent')
      ) {
        matches.push(schemaNode);
      }

      for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
        const alternatives = schemaNode[keyword];
        if (Array.isArray(alternatives)) {
          for (const alternative of alternatives) {
            matches.push(...findAiSchemas(alternative));
          }
        }
      }

      return matches;
    }

    const aiSchemas = findAiSchemas(items);

    expect(aiSchemas).toHaveLength(1);
    const aiProperties = (aiSchemas[0] as Record<string, unknown>).properties as Record<string, unknown>;
    const verificationIntent = aiProperties.verificationIntent as Record<string, unknown>;
    expect(verificationIntent.minItems).toBeUndefined();
  });

  it.each(Object.keys(createInputs()) as (keyof PlanProducerBundleInputs)[])('isolates diagnostics for %s', (field) => {
    const baseline = planProducerBundleComponentDiagnostics(createInputs());
    const changed = planProducerBundleComponentDiagnostics({ ...createInputs(), [field]: field.endsWith('Revision') ? 2 : 'changed' } as PlanProducerBundleInputs);
    expect(Object.entries(changed).filter(([key, value]) => value !== baseline[key as keyof typeof baseline]).map(([key]) => key)).toEqual([field]);
  });

  it('uses hashes for text and schema diagnostics while preserving raw revision integers', () => {
    const inputs = createInputs({ instructionCoveragePolicyRevision: 17, generatorSecretPolicyRevision: 23 });
    const diagnostics = planProducerBundleComponentDiagnostics(inputs);

    expect(diagnostics.generatorPromptTemplate).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.generatorTaskInstruction).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.generatedPlanResponseSchema).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.generatedPlanResponseLocalContract).toMatch(/^[0-9a-f]{64}$/);
    expect(diagnostics.instructionCoveragePolicyRevision).toBe(inputs.instructionCoveragePolicyRevision);
    expect(diagnostics.generatorSecretPolicyRevision).toBe(inputs.generatorSecretPolicyRevision);
  });
});
