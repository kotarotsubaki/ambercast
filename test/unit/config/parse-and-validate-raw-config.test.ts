import { describe, expect, it } from 'vitest';
import type { RawConfig } from '#core/config/schema.js';

const CONFIG_SCHEMA_URL = 'https://ambercast.dev/schema/config.json';
const CONFIG_PATH = '/workspace/ambercast.config.json';

type ParseAndValidateRawConfig = (text: string, path: string) => RawConfig;

async function plannedParser(): Promise<ParseAndValidateRawConfig> {
  const module = await import('#config/load.js') as typeof import('#config/load.js') & {
    readonly parseAndValidateRawConfig?: ParseAndValidateRawConfig;
  };

  expect(module.parseAndValidateRawConfig).toBeTypeOf('function');
  return module.parseAndValidateRawConfig as ParseAndValidateRawConfig;
}

describe('parseAndValidateRawConfig', () => {
  it('parses and validates a valid raw configuration document', async () => {
    const parseAndValidateRawConfig = await plannedParser();
    const text = JSON.stringify({ $schema: CONFIG_SCHEMA_URL, secrets: { allow: ['account.password'] } });

    expect(parseAndValidateRawConfig(text, CONFIG_PATH)).toStrictEqual({
      $schema: CONFIG_SCHEMA_URL,
      secrets: { allow: ['account.password'] },
    });
  });

  it('wraps malformed JSON in ConfigInvalidError', async () => {
    const parseAndValidateRawConfig = await plannedParser();

    expect(() => parseAndValidateRawConfig('{"$schema":', CONFIG_PATH)).toThrow('Configuration file contains malformed JSON.');
  });
});
