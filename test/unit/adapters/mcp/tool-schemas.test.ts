import { describe, expect, it } from 'vitest';

import {
  checkInputSchema,
  generateInputSchema,
  healInputSchema,
  runInputSchema,
} from '#adapters/mcp/tool-schemas.js';

describe('mcp/tool-schemas', () => {
  it('reports malformed run grep as a validation error', () => {
    const result = runInputSchema.safeParse({ grep: '(' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid regex pattern');
    }
  });
  it.each([
    ['generate', generateInputSchema],
    ['run', runInputSchema],
    ['check', checkInputSchema],
    ['heal', healInputSchema],
  ] as const)('%s currently accepts an empty object and rejects unknown keys', (_tool, schema) => {
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it.each([
    ['run', runInputSchema],
    ['check', checkInputSchema],
    ['heal', healInputSchema],
  ] as const)('%s rejects target', (_tool, schema) => {
    expect(schema.safeParse({ target: 'web' }).success).toBe(false);
  });

  it('generate accepts target', () => {
    expect(generateInputSchema.safeParse({ target: 'web' }).success).toBe(true);
  });

  describe('TEST-D3: heal preview/apply input boundary', () => {
    const applyToken = '0123456789abcdef0123456789abcdef';

    it('accepts an apply call containing only dryRun: false and an applyToken', () => {
      expect(healInputSchema.safeParse({ dryRun: false, applyToken }).success).toBe(true);
    });

    it('rejects an apply call without an applyToken', () => {
      expect(healInputSchema.safeParse({ dryRun: false }).success).toBe(false);
    });

    it('rejects an apply call with an empty applyToken', () => {
      expect(healInputSchema.safeParse({ dryRun: false, applyToken: '' }).success).toBe(false);
    });

    it.each([
      ['files', ['other.test.md']],
      ['ai', 'claude'],
      ['allowEmpty', false],
    ] as const)('rejects an apply call that also specifies %s', (field, value) => {
      expect(healInputSchema.safeParse({
        dryRun: false,
        applyToken,
        [field]: value,
      }).success).toBe(false);
    });

    it.each([
      ['omitted', {}],
      ['true', { dryRun: true }],
    ] as const)('rejects a preview call with an applyToken when dryRun is %s', (_case, input) => {
      expect(healInputSchema.safeParse({ ...input, applyToken }).success).toBe(false);
    });

    it.each([
      ['omitted', {}],
      ['true', { dryRun: true }],
    ] as const)('accepts a preview call without an applyToken when dryRun is %s', (_case, input) => {
      expect(healInputSchema.safeParse({ ...input, files: ['case.test.md'], ai: 'codex', allowEmpty: true }).success).toBe(true);
    });
  });
});
