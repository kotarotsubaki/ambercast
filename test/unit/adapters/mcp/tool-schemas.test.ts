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
});
