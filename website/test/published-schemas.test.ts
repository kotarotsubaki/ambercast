import { describe, expect, it } from 'vitest';
import { orderSchemaFilenames } from '../scripts/lib/published-schemas.mjs';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('orderSchemaFilenames', () => {
  it('orders the current six published schema files by kind then version, regardless of input order', () => {
    const shuffled = [
      'plan.v3.schema.json',
      'report.v3.schema.json',
      'config.schema.json',
      'grounding.v2.schema.json',
      'plan.v4.schema.json',
      'plan.v2.schema.json',
    ];
    expect(orderSchemaFilenames(shuffled)).toStrictEqual([
      'config.schema.json',
      'plan.v2.schema.json',
      'plan.v3.schema.json',
      'plan.v4.schema.json',
      'grounding.v2.schema.json',
      'report.v3.schema.json',
    ]);
  });

  it('orders versions numerically, not lexicographically', () => {
    expect(orderSchemaFilenames(['plan.v10.schema.json', 'plan.v9.schema.json', 'plan.v2.schema.json'])).toStrictEqual([
      'plan.v2.schema.json',
      'plan.v9.schema.json',
      'plan.v10.schema.json',
    ]);
  });

  it('orders mixed kinds as config, plan, grounding, report', () => {
    expect(
      orderSchemaFilenames(['report.v1.schema.json', 'grounding.v1.schema.json', 'plan.v1.schema.json', 'config.schema.json']),
    ).toStrictEqual(['config.schema.json', 'plan.v1.schema.json', 'grounding.v1.schema.json', 'report.v1.schema.json']);
  });

  it('does not mutate the input array and returns a new array', () => {
    const input = ['plan.v3.schema.json', 'config.schema.json', 'plan.v2.schema.json'];
    const before = [...input];
    const result = orderSchemaFilenames(input);
    expect(input).toStrictEqual(before);
    expect(result).not.toBe(input);
  });

  it('accepts and returns a single-element array unchanged', () => {
    const input = ['config.schema.json'];
    const result = orderSchemaFilenames(input);
    expect(result).toStrictEqual(['config.schema.json']);
    expect(result).not.toBe(input);
  });

  it.each([
    ['config.v1.schema.json'],
    ['plan.schema.json'],
    ['plan.v0.schema.json'],
    ['plan.v01.schema.json'],
    ['plan.v1000000000000000.schema.json'],
    ['other.v1.schema.json'],
    ['plan.v2.schema.json.bak'],
    ['README.md'],
  ])('rejects %s as unrecognized', (invalidName) => {
    const message = `unrecognized published schema file: ${invalidName}`;
    expect(() => orderSchemaFilenames(['config.schema.json', invalidName])).toThrow(new RegExp(`^${escapeRegExp(message)}$`));
  });

  it('reports the earlier of two unrecognized names in iteration order', () => {
    const message = 'unrecognized published schema file: README.md';
    expect(() => orderSchemaFilenames(['README.md', 'plan.schema.json'])).toThrow(new RegExp(`^${escapeRegExp(message)}$`));
  });

  it('accepts 15-digit versions and orders them numerically', () => {
    expect(
      orderSchemaFilenames(['plan.v999999999999999.schema.json', 'plan.v999999999999998.schema.json']),
    ).toStrictEqual(['plan.v999999999999998.schema.json', 'plan.v999999999999999.schema.json']);
  });

  it('throws for an empty array', () => {
    expect(() => orderSchemaFilenames([])).toThrow(new RegExp(`^${escapeRegExp('no published schema files')}$`));
  });

  it('throws for a duplicate name', () => {
    const message = 'duplicate published schema file: plan.v2.schema.json';
    expect(() => orderSchemaFilenames(['plan.v2.schema.json', 'plan.v2.schema.json'])).toThrow(
      new RegExp(`^${escapeRegExp(message)}$`),
    );
  });

  it('reports the unrecognized-name error before the duplicate error when both are present', () => {
    const message = 'unrecognized published schema file: README.md';
    expect(
      () => orderSchemaFilenames(['plan.v2.schema.json', 'plan.v2.schema.json', 'README.md']),
    ).toThrow(new RegExp(`^${escapeRegExp(message)}$`));
  });
});
