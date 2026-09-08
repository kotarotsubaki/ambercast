/*
 * Derives the public config-file schema from the core-owned zod definition.
 * This follows the IR schema conversion boundary so build tools can generate
 * the packaged schema through core, which they may import, without reaching
 * into the higher configuration layer.
 */

import { z } from 'zod';
import { RawConfig } from './schema.js';

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
    $id: 'https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json',
    title: 'ambercast config schema',
    description: 'Validates the parsed contents of a present Ambercast configuration file.',
  };
}
