/*
 * Derives the public config-file schema from the core-owned zod definition.
 * This follows the IR schema conversion boundary so build tools can generate
 * the packaged schema through core, which they may import, without reaching
 * into the higher configuration layer.
 */

import { z } from 'zod';
import { RawConfig } from './schema.js';

/**
 * Canonical identity for the generated configuration schema.
 *
 * The consent writer uses the same public identifier when it creates a new
 * configuration, so a generated document and its published validation schema
 * cannot disagree about their contract (SPEC-C2-1, SPEC-C2-9).
 */
export const CONFIG_SCHEMA_ID = 'https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json';

/**
 * Returns a JSON Schema 2020-12 representation of the raw configuration
 * document.
 *
 * @returns A newly derived schema suitable for independent validation or
 *   packaged-schema generation.
 * @remarks
 * This getter mirrors the IR conversion getter instead of maintaining a
 * handwritten config schema, so zod validation and published structure cannot
 * drift apart. It attaches the published schema identifier, title, and
 * description to that derived document.
 */
export function getConfigJsonSchema(): z.core.JSONSchema.BaseSchema {
  return {
    ...z.toJSONSchema(RawConfig),
    $id: CONFIG_SCHEMA_ID,
    title: 'ambercast config schema',
    description: 'Validates the parsed contents of a present Ambercast configuration file.',
  };
}
