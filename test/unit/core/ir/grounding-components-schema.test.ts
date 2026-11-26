/** Runtime and published validators must reject the same unsafe partial evidence. */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getGroundingJsonSchema } from '#core/ir/json-schema.js';
import { ElementGroundingEntryV5, GroundingDocument, GROUNDING_SCHEMA_VERSION, readGroundingDocument } from '#core/ir/schema.js';
import { writeGeneratedArtifacts } from '../../../../src/build-tools/generate-json-schema.js';
import { loadCorpus } from '../../../support/corpus.js';

// Historical bytes keep the published legacy contract independent of the current generator.
const FROZEN_V4_GROUNDING_SCHEMA_SHA256 = '77907d221ecd01f0605f279bde79aeb3e3e4211ebe2b5fb8cf585d23f2344c22';
const FROZEN_V4_GROUNDING_SCHEMA_BYTES = 8049;
const frozenUrl = new URL('../../../../website/src/schemas-frozen/grounding.v4.schema.json', import.meta.url);
const legacy = { schemaVersion: 4, planDigest: 'a'.repeat(64), entries: {} };

describe('TEST-COMP-5 component schema parity', () => {
  const schemas = { value: z.object({ entries: z.record(z.string(), z.unknown()) }).passthrough(), expected: z.boolean() };
  it.each(loadCorpus(new URL('../../../fixtures/corpus/grounding/components-v5.jsonl', import.meta.url), schemas))('line $line: $note', ({ value, expected }) => {
    const validate = new Ajv2020({ strict: true }).compile(getGroundingJsonSchema());
    const runtime = GroundingDocument.safeParse(value).success;
    const published = validate(value);
    expect.soft(ElementGroundingEntryV5.safeParse(value.entries.click).success).toBe(expected);
    expect.soft(runtime).toBe(expected);
    expect.soft(published).toBe(expected);
    expect(published).toBe(runtime);
  });
});

describe('TEST-COMP-9 versioned public contracts', () => {
  it('publishes only the v5 identity', () => {
    expect(GROUNDING_SCHEMA_VERSION).toBe(5);
    expect(getGroundingJsonSchema()).toMatchObject({ $id: 'https://kotarotsubaki.github.io/ambercast/schemas/grounding.v5.schema.json', title: 'ambercast grounding schema v5' });
  });
  it('keeps the exact pre-change v4 build bytes', () => {
    expect(existsSync(frozenUrl), 'The historical schema must be committed.').toBe(true);
    const bytes = readFileSync(frozenUrl);
    expect(bytes.byteLength).toBe(FROZEN_V4_GROUNDING_SCHEMA_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(FROZEN_V4_GROUNDING_SCHEMA_SHA256);
  });
  it('rejects v4 at write boundaries while retaining legacy read boundaries', () => {
    expect.soft(GroundingDocument.safeParse(legacy).success).toBe(false);
    expect.soft(new Ajv2020({ strict: true }).compile(getGroundingJsonSchema())(legacy)).toBe(false);
    expect(readGroundingDocument(legacy)).toEqual(legacy);
    expect(existsSync(frozenUrl)).toBe(true);
    expect(new Ajv2020({ strict: true }).compile(JSON.parse(readFileSync(frozenUrl, 'utf8')))(legacy)).toBe(true);
  });
  it('advertises grounding v5 through the capability generator authority', () => {
    const outputs = new Map<string, string>();
    writeGeneratedArtifacts({ outDir: '/virtual', writeFile: (path, content) => { outputs.set(path, content); } });
    expect(JSON.parse(outputs.get('/virtual/manifest/capabilities.json')!)).toMatchObject({ schemaVersions: { grounding: 5 } });
  });
});
