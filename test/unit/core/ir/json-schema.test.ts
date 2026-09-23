import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { getGroundingJsonSchema, getPlanJsonSchema } from '../../../../src/core/ir/json-schema.js';
import { GroundingDocument, PlanDocument } from '../../../../src/core/ir/schema.js';

type DocumentKind = 'plan' | 'grounding';
type ExpectedVerdict = 'valid' | 'invalid';

interface CorpusFixture {
  document: DocumentKind;
  expected: ExpectedVerdict;
  value: unknown;
}

interface NamedCorpusFixture extends CorpusFixture {
  name: string;
}

const corpusDirectoryUrl = new URL('../../../fixtures/ir/corpus/', import.meta.url);
const corpusDirectory = fileURLToPath(corpusDirectoryUrl);

function isCorpusFixture(value: unknown): value is CorpusFixture {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (candidate.document === 'plan' || candidate.document === 'grounding')
    && (candidate.expected === 'valid' || candidate.expected === 'invalid')
    && 'value' in candidate;
}

function loadCorpus(): NamedCorpusFixture[] {
  return readdirSync(corpusDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const parsed: unknown = JSON.parse(readFileSync(new URL(fileName, corpusDirectoryUrl), 'utf8'));

      if (!isCorpusFixture(parsed)) {
        throw new TypeError(`Invalid IR corpus fixture: ${fileName}`);
      }

      return { ...parsed, name: fileName };
    });
}

const corpus = loadCorpus();
const ajv = new Ajv2020({ strict: true });
const validators = {
  plan: ajv.compile(getPlanJsonSchema()),
  grounding: ajv.compile(getGroundingJsonSchema()),
};

// SPEC-C1 C1-1
interface InvalidPlanReason {
  code: string;
  path: readonly (string | number)[];
  key?: string;
}

const INVALID_PLAN_REASONS = {
  'plan-invalid-v3-retired.json': { code: 'invalid_value', path: ['schemaVersion'] },
  'plan-invalid-ai-embedded-secret-ref.json': { code: 'invalid_format', path: ['steps', 0, 'instruction'] },
  'plan-invalid-ai-trace.json': { code: 'unrecognized_keys', path: ['steps', 0], key: 'trace' },
  'plan-invalid-assert-embedded-secret-ref.json': { code: 'invalid_format', path: ['steps', 0, 'text'] },
  'plan-invalid-assert-text-visible-multiline-embedded-secret-ref.json': { code: 'invalid_format', path: ['steps', 0, 'text'] },
  'plan-invalid-fill-embedded-secret-ref.json': { code: 'invalid_format', path: ['steps', 0, 'value'] },
  'plan-invalid-legacy-ai-secret-source-span.json': { code: 'unrecognized_keys', path: ['steps', 0, 'secrets', 0], key: 'sourceSpan' },
  'plan-invalid-legacy-secret-grant-span.json': { code: 'unrecognized_keys', path: ['steps', 0], key: 'secretGrantSpan' },
  'plan-invalid-literal-fill-secret.json': { code: 'invalid_format', path: ['steps', 0, 'secretRef'] },
  'plan-invalid-missing-action.json': { code: 'invalid_union', path: ['steps', 0, 'action'] },
  'plan-invalid-missing-check.json': { code: 'invalid_union', path: ['steps', 0, 'check'] },
  'plan-invalid-missing-kind.json': { code: 'invalid_union', path: ['steps', 0, 'kind'] },
  'plan-invalid-missing-strategy.json': { code: 'invalid_union', path: ['steps', 0, 'element', 'strategy'] },
  'plan-invalid-secret-ref-embedded.json': { code: 'invalid_format', path: ['steps', 0, 'secretRef'] },
  'plan-invalid-secret-ref-invalid-character.json': { code: 'invalid_format', path: ['steps', 0, 'secretRef'] },
  'plan-invalid-secret-ref-missing-braces.json': { code: 'invalid_format', path: ['steps', 0, 'secretRef'] },
  'plan-invalid-secret-ref-singular-prefix.json': { code: 'invalid_format', path: ['steps', 0, 'secretRef'] },
  'plan-invalid-step-id-leading-digit.json': { code: 'invalid_format', path: ['steps', 0, 'id'] },
  'plan-invalid-target-base-url-embedded-secret-ref.json': { code: 'invalid_format', path: ['targets', 'app', 'baseUrl'] },
  'plan-invalid-unknown-action.json': { code: 'invalid_union', path: ['steps', 0, 'action'] },
  'plan-invalid-unknown-check.json': { code: 'invalid_union', path: ['steps', 0, 'check'] },
  'plan-invalid-unknown-kind.json': { code: 'invalid_union', path: ['steps', 0, 'kind'] },
  'plan-invalid-unknown-plan-property.json': { code: 'unrecognized_keys', path: [], key: 'unexpected' },
  'plan-invalid-unknown-strategy.json': { code: 'invalid_union', path: ['steps', 0, 'element', 'strategy'] },
  'plan-invalid-unknown-target-property.json': { code: 'unrecognized_keys', path: ['targets', 'app'], key: 'unexpected' },
  'plan-invalid-wrong-field-type.json': { code: 'invalid_type', path: ['steps', 0, 'url'] },
} as const satisfies Record<string, InvalidPlanReason>;

describe('IR JSON Schema corpus equivalence', () => {
  it('contains valid and invalid fixtures for plan and grounding documents', () => {
    expect(corpus).not.toHaveLength(0);

    for (const document of ['plan', 'grounding'] as const) {
      const fixtures = corpus.filter((fixture) => fixture.document === document);
      expect(fixtures.some((fixture) => fixture.expected === 'valid')).toBe(true);
      expect(fixtures.some((fixture) => fixture.expected === 'invalid')).toBe(true);
    }
  });

  it.each(corpus)('$name has the expected zod and AJV verdict', (fixture) => {
    const expected = fixture.expected === 'valid';
    const zodSchema = fixture.document === 'plan' ? PlanDocument : GroundingDocument;
    const zodVerdict = zodSchema.safeParse(fixture.value).success;
    const ajvVerdict = validators[fixture.document](fixture.value);

    expect.soft(zodVerdict).toBe(expected);
    expect.soft(ajvVerdict).toBe(expected);
    expect(ajvVerdict).toBe(zodVerdict);
  });

  // SPEC-C1 C1-1
  it.each(corpus.filter((fixture) => fixture.document === 'plan' && fixture.expected === 'invalid' && fixture.name !== 'plan-invalid-v3-retired.json'))(
    '$name remains invalid for a schema reason other than the retired schemaVersion literal',
    (fixture) => {
      const result = PlanDocument.safeParse(fixture.value);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some((issue) => issue.path[0] !== 'schemaVersion')).toBe(true);
    },
  );

  // SPEC-C1 C1-1
  it('assigns every invalid plan fixture its own expected zod issue marker', () => {
    const invalidFixtureNames = corpus
      .filter((fixture) => fixture.document === 'plan' && fixture.expected === 'invalid')
      .map((fixture) => fixture.name)
      .sort();

    expect(Object.keys(INVALID_PLAN_REASONS).sort()).toEqual(invalidFixtureNames);
  });

  // SPEC-C1 C1-1
  it.each(Object.entries(INVALID_PLAN_REASONS))('%s fails for its named invalidity reason', (name, reason) => {
    const fixture = corpus.find((candidate) => candidate.name === name);
    expect(fixture).toBeDefined();
    if (fixture === undefined) return;

    const result = PlanDocument.safeParse(fixture.value);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.some((issue) => {
      if (issue.code !== reason.code || !reason.path.every((segment, index) => issue.path[index] === segment)) {
        return false;
      }
      if (!('key' in reason)) {
        return true;
      }
      return issue.code === 'unrecognized_keys' && issue.keys.includes(reason.key);
    })).toBe(true);
  });
});

describe('IR JSON Schema documents', () => {
  it.each([
    ['plan', getPlanJsonSchema],
    ['grounding', getGroundingJsonSchema],
  ] as const)('returns a strict-compilable JSON Schema 2020-12 document for %s', (_document, getSchema) => {
    const schema = getSchema();

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(() => new Ajv2020({ strict: true }).compile(schema)).not.toThrow();
  });

  it.each([
    [
      'plan',
      getPlanJsonSchema,
      {
        // SPEC-C1 C1-2
        $id: 'https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json',
        title: 'ambercast plan schema v4',
        description: 'Validates the complete generated plan document that is reviewed and committed beside its source test prompt.',
      },
    ],
    [
      'grounding',
      getGroundingJsonSchema,
      {
        $id: 'https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json',
        title: 'ambercast grounding schema v2',
        description: 'Validates the committed grounding cache associated with one plan digest.',
      },
    ],
  ] as const)('publishes the exact %s schema metadata', (_document, getSchema, metadata) => {
    const schema = getSchema();

    expect(schema.$id).toBe(metadata.$id);
    expect(schema.title).toBe(metadata.title);
    expect(schema.description).toBe(metadata.description);
  });

  // SPEC-C1 C1-2
  it('publishes Plan v4 instruction coverage and Grounding-v2 trace coverage (SPEC-1, SPEC-3, SPEC-7)', () => {
    const planV4 = {
      schemaVersion: 4,
      source: { inputsDigest: 'a'.repeat(64) },
      targets: { app: { surface: 'web', baseUrl: 'https://example.test' } },
      steps: [{
        id: 'reach-dashboard',
        kind: 'ai',
        target: 'app',
        instruction: 'Reach the dashboard.',
        instructionCoverage: [{
          id: 'dashboard-reached',
          kind: 'success',
          sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 21 },
        }],
      }],
    };
    const coveredGroundingV2 = {
      schemaVersion: 2,
      planDigest: 'b'.repeat(64),
      entries: {
        'reach-dashboard': {
          kind: 'ai',
          trace: {
            events: [],
            verification: [{ type: 'assert', check: 'text-visible', text: 'Dashboard' }],
            verificationCoverage: { 'dashboard-reached': 0 },
          },
        },
      },
    };

    expect(PlanDocument.safeParse(planV4).success).toBe(true);
    expect(validators.plan(planV4)).toBe(true);
    const { instructionCoverage: _coverage, ...aiStepWithoutCoverage } = planV4.steps[0]!;
    const planWithoutCoverage = { ...planV4, steps: [aiStepWithoutCoverage] };
    expect(PlanDocument.safeParse(planWithoutCoverage).success).toBe(false);
    expect(validators.plan(planWithoutCoverage)).toBe(false);
    expect(PlanDocument.safeParse({ ...planV4, schemaVersion: 3 }).success).toBe(false);
    expect(validators.plan({ ...planV4, schemaVersion: 3 })).toBe(false);
    expect(GroundingDocument.safeParse(coveredGroundingV2).success).toBe(true);
    expect(validators.grounding(coveredGroundingV2)).toBe(true);
  });
});
