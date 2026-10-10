import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SecretLiteralRejectedError } from '#core/errors/secret-literal-rejected-error.js';
import { assertNoLiteralSecrets } from '#usecases/generator-secret-policy.js';
import { loadCorpus } from '../../support/corpus.js';

const value = z.strictObject({
  text: z.string().min(1),
  placement: z.enum(['step-id', 'step-confirms', 'criterion-id', 'generator-meta', 'fill-value', 'ambiguity']),
});
const negativeSchemas = { value, expected: z.literal('accept') };
const positiveSchemas = {
  value,
  expected: z.enum([
    'credential-prefix-sk',
    'credential-prefix-ghp',
    'credential-prefix-aws-access-key',
    'high-entropy-token',
    'embedded-secret-reference',
  ]),
};

function documentAt(text: string, placement: z.infer<typeof value>['placement']): { document: unknown; path: string } {
  switch (placement) {
    case 'step-id': return { document: { steps: [{ id: text }] }, path: 'steps[0].id' };
    case 'step-confirms': return { document: { steps: [{ id: 'a-b', confirms: [text] }] }, path: 'steps[0].confirms[0]' };
    case 'criterion-id': return { document: { steps: [{ id: 'a-b', instructionCoverage: [{ id: text }] }] }, path: 'steps[0].instructionCoverage[0].id' };
    case 'generator-meta': return { document: { generatorMeta: { note: text } }, path: 'generatorMeta.note' };
    case 'fill-value': return { document: { steps: [{ id: 'a-b', value: text }] }, path: 'steps[0].value' };
    case 'ambiguity': return { document: [{ note: text }], path: '[0].note' };
  }
}

const negatives = loadCorpus(new URL('../../fixtures/corpus/secrets/generator-negatives.jsonl', import.meta.url), negativeSchemas);
const positives = loadCorpus(new URL('../../fixtures/corpus/secrets/generator-positives.jsonl', import.meta.url), positiveSchemas);

describe('generator secret corpus', () => {
  describe('TEST-1: accepted values', () => {
    it.each(loadCorpus(new URL('../../fixtures/corpus/secrets/generator-negatives.jsonl', import.meta.url), negativeSchemas))('line $line: $note', (entry) => {
      const { document } = documentAt(entry.value.text, entry.value.placement);
      expect(() => assertNoLiteralSecrets(document)).not.toThrow();
    });
  });

  describe('TEST-2: rejected values', () => {
    it.each(loadCorpus(new URL('../../fixtures/corpus/secrets/generator-positives.jsonl', import.meta.url), positiveSchemas))('line $line: $note', (entry) => {
      const { document, path } = documentAt(entry.value.text, entry.value.placement);
      let caught: unknown;
      try {
        assertNoLiteralSecrets(document);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SecretLiteralRejectedError);
      const rejection = caught as SecretLiteralRejectedError;
      expect(rejection.details).toEqual({ detector: entry.expected, path });
      expect(JSON.stringify(rejection)).not.toContain(entry.value.text);
      expect(JSON.stringify(rejection.details)).not.toContain(entry.value.text);
    });
  });

  it('TEST-3: retains the minimum placement coverage', () => {
    const idPlacements = new Set(['step-id', 'step-confirms', 'criterion-id']);
    expect(negatives.filter((entry) => idPlacements.has(entry.value.placement)).length).toBeGreaterThanOrEqual(12);
    expect(negatives.filter((entry) => !idPlacements.has(entry.value.placement)).length).toBeGreaterThanOrEqual(10);
    expect(positives.length).toBeGreaterThanOrEqual(14);
  });
});
