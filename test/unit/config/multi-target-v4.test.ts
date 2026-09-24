import { describe, expect, it } from 'vitest';
import { RawConfig } from '../../../src/core/config/schema.js';
import { ConfigInvalidError } from '../../../src/core/errors/config-invalid-error.js';
import { loadConfig } from '../../../src/config/load.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';

const path = '/workspace/ambercast.config.json';
const config = { $schema: 'https://ambercast.dev/schema/config.json', targets: { app: { baseUrl: 'https://example.test', executor: { kind: 'playwright', browser: 'chromium' }, surface: 'web', description: 'Customer browser' } }, defaultTarget: 'app' };

describe('Target config for Plan v4', () => {
  it('accepts a web surface and description without publishing them as browser choice', () => {
    expect(RawConfig.safeParse(config).success).toBe(true);
    expect(RawConfig.safeParse({ ...config, targets: { app: { baseUrl: 'https://example.test', executor: { kind: 'playwright', browser: 'chromium' }, description: 'Customer browser' } } }).success).toBe(true);
  });

  it('defaults omitted surface to web in resolved configuration', async () => {
    const storage = createInMemoryStorage();
    await storage.writeText(path, JSON.stringify({ ...config, targets: { app: { baseUrl: 'https://example.test', executor: { kind: 'playwright', browser: 'chromium' }, description: 'Customer browser' } } }));
    const loaded = await loadConfig({ cwd: '/workspace', storage });
    const resolved = 'resolved' in loaded ? loaded.resolved : loaded;
    expect(resolved.targets.app).toMatchObject({ surface: 'web', description: 'Customer browser' });
  });

  it('rejects unsupported surface', () => {
    expect(RawConfig.safeParse({ ...config, targets: { app: { ...config.targets.app, surface: 'mobile' } } }).success).toBe(false);
  });

  it('reports an unconfigured default Target as config-invalid', async () => {
    const storage = createInMemoryStorage();
    await storage.writeText(path, JSON.stringify({ ...config, defaultTarget: 'missing' }));
    await expect(loadConfig({ cwd: '/workspace', storage })).rejects.toMatchObject({
      kind: 'config-invalid',
      exitCode: 2,
    } satisfies Partial<ConfigInvalidError>);
  });
});
