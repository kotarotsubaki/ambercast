import { describe, expect, it } from 'vitest';
import {
  computeIntentDigest,
  computeInputsDigest,
  computePlanDigest,
  isPlanDigestCurrent,
} from '../../../../src/core/ir/digest.js';
import type { DigestInputs } from '../../../../src/core/ir/digest.js';
import type { NormalizedTestMd } from '../../../../src/core/ir/normalize.js';
import { GroundingDocument, PlanDocument } from '../../../../src/core/ir/schema.js';
import type { JsonValueT, TargetDefinition } from '../../../../src/core/ir/schema.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

describe('TEST-I7 computeIntentDigest', () => {
  const sourceSpan = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 };
  const baseline = {
    stepKind: 'action' as const,
    operation: 'click' as const,
    intent: {
      description: 'Submit',
      sourceSpan,
      roleHint: 'button',
      quote: { text: 'Submit', sourceSpan },
    },
  };

  it('pins the digest of a fixed input', () => {
    expect(computeIntentDigest(baseline)).toBe('e765672a1bc3a07695aa183977e60030539d03a323c01effa9c4491d29719687');
  });

  it('returns the same digest for the same input twice', () => {
    expect(computeIntentDigest(baseline)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeIntentDigest(baseline)).toBe(computeIntentDigest(baseline));
  });

  it.each([
    ['description', { ...baseline, intent: { ...baseline.intent, description: 'Send' } }],
    ['one span coordinate', { ...baseline, intent: { ...baseline.intent, sourceSpan: { ...sourceSpan, endColumn: 6 } } }],
    ['roleHint', { ...baseline, intent: { ...baseline.intent, roleHint: 'link' } }],
    ['quote', { ...baseline, intent: { ...baseline.intent, quote: { ...baseline.intent.quote, text: 'Send' } } }],
    ['operation', { ...baseline, operation: 'press' as const }],
    ['stepKind', { ...baseline, stepKind: 'capture' as const }],
  ])('changes when only %s changes', (_field, changed) => {
    expect(computeIntentDigest(changed)).not.toBe(computeIntentDigest(baseline));
  });

  it('ignores key insertion order in an equivalent object', () => {
    const reordered = {
      intent: {
        quote: { sourceSpan: { endColumn: 7, endLine: 1, startColumn: 1, startLine: 1 }, text: 'Submit' },
        roleHint: 'button',
        sourceSpan: { endColumn: 7, endLine: 1, startColumn: 1, startLine: 1 },
        description: 'Submit',
      },
      operation: 'click' as const,
      stepKind: 'action' as const,
    };
    expect(computeIntentDigest(reordered)).toBe(computeIntentDigest(baseline));
  });
});

function targetDefinition(baseUrl = 'https://example.test'): TargetDefinition {
  return { surface: 'web', baseUrl };
}

function asNormalizedTestMd(value: string): NormalizedTestMd {
  return value as NormalizedTestMd;
}

function createInputs(overrides: Partial<DigestInputs> = {}): DigestInputs {
  return {
    normalizedTestMd: asNormalizedTestMd('# Smoke\n'),
    schemaVersion: 5,
    generatorPromptTemplateFingerprint: 'generator-template-v2',
    planProducerBundleFingerprint: 'producer-bundle-v1',
    targetDefinitions: { app: targetDefinition() },
    ...overrides,
  };
}

function createPlan({
  inputsDigest = DIGEST_A,
  targetBaseUrl = 'https://example.test',
  navigateUrl = 'https://example.test/login',
  generatorMeta,
}: {
  inputsDigest?: string;
  targetBaseUrl?: string;
  navigateUrl?: string;
  generatorMeta?: Record<string, JsonValueT>;
} = {}): PlanDocument {
  return PlanDocument.parse({
    schemaVersion: 5,
    source: { inputsDigest },
    ...(generatorMeta === undefined ? {} : { generatorMeta }),
    targets: { app: targetDefinition(targetBaseUrl) },
    steps: [
      {
        id: 'navigate-home',
        target: 'app',
        kind: 'action',
        action: 'navigate',
        url: navigateUrl,
      },
    ],
  });
}

function createGrounding(planDigest: string): GroundingDocument {
  return GroundingDocument.parse({
    schemaVersion: 3,
    planDigest,
    entries: {},
  });
}

describe('computeInputsDigest', () => {
  it('TEST-L2 changes for adding, changing, and deleting a projected locale', () => {
    const variants = [undefined, 'ja-JP', 'en-US'] as const;
    const digests = variants.map((locale) => computeInputsDigest(createInputs({
      targetDefinitions: { app: { ...targetDefinition(), ...(locale === undefined ? {} : { locale }) } },
    })));
    expect(new Set(digests).size).toBe(3);
  });
  it('returns lowercase SHA-256 hex for equivalent inputs constructed in different orders', () => {
    const first = createInputs({
      targetDefinitions: {
        production: targetDefinition('https://production.example.test'),
        staging: targetDefinition('https://staging.example.test'),
      },
    });
    const second = createInputs({
      targetDefinitions: {
        staging: targetDefinition('https://staging.example.test'),
        production: targetDefinition('https://production.example.test'),
      },
    });

    expect(computeInputsDigest(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeInputsDigest(first)).toBe(computeInputsDigest(second));
  });

  // The expected SHA-256 was calculated without calling the implementation.
  // SPEC-1 and SPEC-4 bind the oracle to Plan v5 and the web surface rather than a browser choice.
  // Its exact JCS preimage is {"generatorPromptTemplateFingerprint":"generator-template-v2","normalizedTestMd":"# Smoke\n","planProducerBundleFingerprint":"producer-bundle-v1","schemaVersion":5,"targetDefinitions":{"app":{"baseUrl":"https://example.test","surface":"web"}}}.
  it('matches the independently derived SHA-256 oracle for the fixed preimage', () => {
    expect(computeInputsDigest(createInputs())).toBe('474ed74c14cd605a7fd5e7fbdcef48e267735833ef188789529cb6d11b921a5a');
  });

  // The `-?` modifier prevents a future optional DigestInputs field from silently evading this completeness check.
  // Each mutator receives the baseline and returns a new object that changes only the field it covers.
  interface FieldMutation {
    readonly displayName: string;
    readonly mutate: (inputs: DigestInputs) => DigestInputs;
  }

  const FIELD_MUTATIONS: { [K in keyof DigestInputs]-?: FieldMutation } = {
    normalizedTestMd: {
      displayName: 'normalized test Markdown',
      mutate: (inputs) => ({ ...inputs, normalizedTestMd: asNormalizedTestMd('# Changed smoke\n') }),
    },
    schemaVersion: {
      displayName: 'schema version',
      mutate: (inputs) => ({ ...inputs, schemaVersion: inputs.schemaVersion + 1 }),
    },
    generatorPromptTemplateFingerprint: {
      displayName: 'generator prompt-template fingerprint',
      mutate: (inputs) => ({ ...inputs, generatorPromptTemplateFingerprint: 'generator-template-v2-mutated' }),
    },
    planProducerBundleFingerprint: {
      displayName: 'plan producer-bundle fingerprint',
      mutate: (inputs) => ({ ...inputs, planProducerBundleFingerprint: 'producer-bundle-v1-mutated' }),
    },
    targetDefinitions: {
      displayName: 'target definitions',
      mutate: (inputs) => ({
        ...inputs,
        targetDefinitions: { app: targetDefinition('https://changed.example.test') },
      }),
    },
  };

  it.each(Object.values(FIELD_MUTATIONS))('changes when only the $displayName changes', ({ mutate }) => {
    const baseline = createInputs();

    expect(computeInputsDigest(mutate(baseline))).not.toBe(computeInputsDigest(baseline));
  });

  it('is unchanged across fresh deep-equal input objects', () => {
    expect(computeInputsDigest(createInputs())).toBe(computeInputsDigest(createInputs()));
  });

  it('changes when a target is renamed even when its definition is identical', () => {
    const baseline = createInputs({ targetDefinitions: { production: targetDefinition() } });
    const renamed = createInputs({ targetDefinitions: { staging: targetDefinition() } });

    expect(computeInputsDigest(renamed)).not.toBe(computeInputsDigest(baseline));
  });

  it('changes when only a target secret-sink origin policy changes', () => {
    const baseline = createInputs();
    const changed = createInputs({
      targetDefinitions: {
        app: {
          ...targetDefinition(),
          secretSinkOrigins: { '{{secrets.app.password}}': ['https://idp.example.test'] },
        },
      },
    });

    expect(computeInputsDigest(changed)).not.toBe(computeInputsDigest(baseline));
  });

  it('does not change when the same named targets are inserted in a different order', () => {
    const first = createInputs({
      targetDefinitions: {
        production: targetDefinition('https://production.example.test'),
        staging: targetDefinition('https://staging.example.test'),
      },
    });
    const reordered = createInputs({
      targetDefinitions: {
        staging: targetDefinition('https://staging.example.test'),
        production: targetDefinition('https://production.example.test'),
      },
    });

    expect(computeInputsDigest(reordered)).toBe(computeInputsDigest(first));
  });

  it('hashes only its five declared fields when passed a structurally wider runtime object', () => {
    const declaredInputs = createInputs();
    const widerRuntimeInputs = {
      ...declaredInputs,
      extraRuntimeProperty: 'must not affect the digest',
    } as DigestInputs;

    expect(computeInputsDigest(widerRuntimeInputs)).toBe(computeInputsDigest(declaredInputs));
  });
});

describe('computePlanDigest', () => {
  it('excludes generatorMeta from the digest', () => {
    const withoutGeneratorMeta = createPlan();
    const withGeneratorMeta = createPlan({ generatorMeta: { model: 'generator', retryCount: 1 } });

    expect(computePlanDigest(withoutGeneratorMeta)).toBe(computePlanDigest(withGeneratorMeta));
  });

  it.each([
    ['the input digest', createPlan({ inputsDigest: DIGEST_B })],
    ['a target definition', createPlan({ targetBaseUrl: 'https://other.example.test' })],
    ['a replay step', createPlan({ navigateUrl: 'https://example.test/dashboard' })],
  ])('changes when %s differs', (_field, changedPlan) => {
    expect(computePlanDigest(changedPlan)).not.toBe(computePlanDigest(createPlan()));
  });
});

describe('isPlanDigestCurrent', () => {
  it('accepts grounding that records the supplied plan digest', () => {
    const groundingWithA = createGrounding(DIGEST_A);

    expect(isPlanDigestCurrent(groundingWithA, DIGEST_A)).toBe(true);
  });

  it('rejects grounding that records a different plan digest', () => {
    const groundingWithB = createGrounding(DIGEST_B);

    expect(isPlanDigestCurrent(groundingWithB, DIGEST_A)).toBe(false);
  });

  it('tracks grounding provenance through real plan digest calculations', () => {
    const originalPlan = createPlan();
    const originalPlanDigest = computePlanDigest(originalPlan);
    const groundingCachedForOriginalPlan = createGrounding(originalPlanDigest);
    const planAfterCanonicalFieldChange = createPlan({
      navigateUrl: 'https://example.test/dashboard',
    });
    const planAfterGeneratorMetaOnlyChange = createPlan({
      generatorMeta: { model: 'generator-v2' },
    });
    const canonicalChangePlanDigest = computePlanDigest(planAfterCanonicalFieldChange);
    const generatorMetaOnlyChangePlanDigest = computePlanDigest(planAfterGeneratorMetaOnlyChange);

    expect(isPlanDigestCurrent(groundingCachedForOriginalPlan, originalPlanDigest)).toBe(true);
    expect(canonicalChangePlanDigest).not.toBe(originalPlanDigest);
    expect(isPlanDigestCurrent(groundingCachedForOriginalPlan, canonicalChangePlanDigest)).toBe(false);
    expect(generatorMetaOnlyChangePlanDigest).toBe(originalPlanDigest);
    expect(isPlanDigestCurrent(groundingCachedForOriginalPlan, generatorMetaOnlyChangePlanDigest)).toBe(true);
  });
});
