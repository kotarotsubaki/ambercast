import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateAiResponse } from '#adapters/ai/shared/response-validator.js';
import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { GeneratedPlanResponseRequest } from '#core/ir/schema.js';
import { REDACTED_ISSUE_PATH_SEGMENT } from '#core/ai/response-issue-path.js';

function schema() {
  return typedJsonSchema(z.object({ ok: z.boolean(), count: z.int().positive() }));
}

describe('validateAiResponse', () => {
  it('parses and returns data satisfying the requested JSON Schema', () => {
    expect(validateAiResponse('{"ok":true,"count":1}', schema())).toEqual({ ok: true, count: 1 });
  });

  it('classifies malformed JSON with one closed-code empty-path issue and raw text', () => {
    const raw = '{"ok":';

    expect(() => validateAiResponse(raw, schema())).toThrow(AiResponseInvalidError);
    try {
      validateAiResponse(raw, schema());
    } catch (error) {
      expect(error).toMatchObject({ kind: 'ai-response-invalid', details: { raw, issues: [{ code: 'invalid-json', path: [] }] } });
    }
  });

  it('normalizes every schema-validation issue to a redacted segment path', () => {
    const raw = '{"ok":"no","extra":true}';

    expect(() => validateAiResponse(raw, schema())).toThrow(AiResponseInvalidError);
    try {
      validateAiResponse(raw, schema());
    } catch (error) {
      expect(error).toMatchObject({
        details: {
          raw,
          issues: expect.arrayContaining([
            { code: 'schema-mismatch', path: ['ok'] },
            { code: 'schema-mismatch', path: ['count'] },
          ]),
        },
      });
    }
  });

  it('distinguishes a root schema violation from malformed JSON', () => {
    try {
      validateAiResponse('false', schema());
    } catch (error) {
      expect(error).toMatchObject({ details: { issues: [{ code: 'schema-mismatch', path: [] }] } });
    }
  });

  it('registers standard JSON Schema formats before validating provider data', () => {
    const urlSchema = typedJsonSchema(z.object({ callbackUrl: z.url() }));

    expect(validateAiResponse('{"callbackUrl":"https://example.test/callback"}', urlSchema))
      .toEqual({ callbackUrl: 'https://example.test/callback' });
    expect(() => validateAiResponse('{"callbackUrl":"not a URL"}', urlSchema))
      .toThrow(AiResponseInvalidError);
  });

  it('unescapes required property names before projecting a segment path', () => {
    const slashKeySchema = typedJsonSchema(z.object({ 'token~/key': z.string() }));

    expect(() => validateAiResponse('{}', slashKeySchema)).toThrow(AiResponseInvalidError);
    try {
      validateAiResponse('{}', slashKeySchema);
    } catch (error) {
      expect(error).toMatchObject({
        details: { issues: [{ code: 'schema-mismatch', path: ['token~/key'] }] },
      });
    }
  });

  it('uses the production generated-response schema when a generatorMeta value has the wrong container type', () => {
    const raw = JSON.stringify({ steps: [], ambiguities: [], generatorMeta: [] });

    expect(() => validateAiResponse(raw, typedJsonSchema(GeneratedPlanResponseRequest))).toThrow(AiResponseInvalidError);
    try {
      validateAiResponse(raw, typedJsonSchema(GeneratedPlanResponseRequest));
    } catch (error) {
      expect(error).toMatchObject({ details: { issues: [{ code: 'schema-mismatch', path: ['generatorMeta'] }] } });
    }
  });

  it('redacts a dynamic generatorMeta child in a production-schema validation path', () => {
    const productionSchema = typedJsonSchema(GeneratedPlanResponseRequest);
    const productionSchemaRecord = productionSchema as { readonly $defs?: unknown };
    const schemaWithDynamicChildConstraint = {
      $defs: productionSchemaRecord.$defs,
      allOf: [
        productionSchema,
        {
          type: 'object',
          properties: {
            generatorMeta: {
              type: 'object',
              properties: { providerSecret: { type: 'string' } },
            },
          },
        },
      ],
    } as unknown as typeof productionSchema;
    const raw = JSON.stringify({ steps: [], ambiguities: [], generatorMeta: { providerSecret: 42 } });

    expect(() => validateAiResponse(raw, schemaWithDynamicChildConstraint)).toThrow(AiResponseInvalidError);
    try {
      validateAiResponse(raw, schemaWithDynamicChildConstraint);
    } catch (error) {
      expect(error).toMatchObject({
        details: {
          issues: expect.arrayContaining([
            { code: 'schema-mismatch', path: ['generatorMeta', REDACTED_ISSUE_PATH_SEGMENT] },
          ]),
        },
      });
    }
  });

  it('uses the parsed array shape to turn a JSON Pointer "0" segment into index 0', () => {
    const arraySchema = typedJsonSchema(z.object({ values: z.array(z.int()) }));

    try {
      validateAiResponse('{"values":["wrong"]}', arraySchema);
    } catch (error) {
      expect(error).toMatchObject({ details: { issues: [{ code: 'schema-mismatch', path: ['values', 0] }] } });
    }
  });
});
