import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProviderFixtureValue, type ProviderFixture } from '../../support/provider-fixture.js';
import {
  validResponse, truncatedJson, emptyStdoutExitZero, emptyOutputFile, nonZeroExit, hangUntilTimeout,
} from '../../support/provider-fault-builders.js';

const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const providers = ['claude-code-cli', 'codex-cli'] as const;

describe('synthetic provider fault builders', () => {
  it.each([
    { name: 'validResponse', provider: 'claude-code-cli', build: () => validResponse('claude-code-cli', { a: 1 }), stdout: '{"result":"{\\"a\\":1}"}' },
    { name: 'validResponse', provider: 'codex-cli', build: () => validResponse('codex-cli', { a: 1 }), stdout: '', outputFile: '{"a":1}' },
    { name: 'truncatedJson', provider: 'claude-code-cli', build: () => truncatedJson('claude-code-cli', { a: 1 }, { keep: 3 }), stdout: '{"result":"{\\"a"}' },
    { name: 'truncatedJson', provider: 'codex-cli', build: () => truncatedJson('codex-cli', { a: 1 }, { keep: 3 }), stdout: '', outputFile: '{"a' },
    { name: 'truncatedJson', provider: 'claude-code-cli', build: () => truncatedJson('claude-code-cli', { a: 1 }, { keep: 5, layer: 'transport' }), stdout: '{"res' },
    { name: 'emptyStdoutExitZero', provider: 'claude-code-cli', build: emptyStdoutExitZero, stdout: '' },
    { name: 'emptyOutputFile', provider: 'codex-cli', build: emptyOutputFile, stdout: '', outputFile: '' },
  ] as const)('TEST-11 $name for $provider preserves exact streams and provenance', ({ name, provider, build, stdout, ...rest }) => {
    const fixture = build();
    expect(ProviderFixtureValue.parse(fixture)).toStrictEqual(fixture);
    expect(fixture.provider).toBe(provider);
    expect(fixture.provenance).toStrictEqual({ ambercast: version, input: expect.stringMatching(new RegExp(`^${name}\\(`)), origin: 'synthetic' });
    expect(fixture.run).toStrictEqual({ exitCode: 0 });
    expect(fixture.stdout).toBe(stdout);
    expect(fixture.stderr).toBe('');
    expect(fixture.delayMs).toBe(0);
    if ('outputFile' in rest) expect(fixture.outputFile).toBe(rest.outputFile);
    else expect(fixture).not.toHaveProperty('outputFile');
  });

  it.each([
    { provider: 'claude-code-cli', layer: 'payload', keep: 1, stdout: '{"result":"{"}' },
    { provider: 'claude-code-cli', layer: 'payload', keep: 6, stdout: '{"result":"{\\"a\\":1"}' },
    { provider: 'codex-cli', layer: 'payload', keep: 1, stdout: '', outputFile: '{' },
    { provider: 'codex-cli', layer: 'payload', keep: 6, stdout: '', outputFile: '{"a":1' },
    { provider: 'claude-code-cli', layer: 'transport', keep: 1, stdout: '{' },
    { provider: 'claude-code-cli', layer: 'transport', keep: 21, stdout: '{"result":"{\\"a\\":1}"' },
  ] as const)('TEST-11 accepts $provider $layer boundary keep=$keep', ({ provider, layer, keep, stdout, ...rest }) => {
    const fixture = truncatedJson(provider, { a: 1 }, { layer, keep });
    expect(ProviderFixtureValue.parse(fixture)).toStrictEqual(fixture);
    expect(fixture.stdout).toBe(stdout);
    if ('outputFile' in rest) expect(fixture.outputFile).toBe(rest.outputFile);
    else expect(fixture).not.toHaveProperty('outputFile');
  });

  it.each([
    { provider: 'claude-code-cli', layer: 'payload', stdout: '{"result":"{\\"a"}' },
    { provider: 'codex-cli', layer: 'payload', stdout: '', outputFile: '{"a' },
    { provider: 'claude-code-cli', layer: 'transport', stdout: '{"result":"' },
  ] as const)('TEST-11 defaults $provider $layer keep to half the selected length', ({ provider, layer, stdout, ...rest }) => {
    const fixture = truncatedJson(provider, { a: 1 }, layer === 'payload' ? undefined : { layer });
    expect(fixture.stdout).toBe(stdout);
    if ('outputFile' in rest) expect(fixture.outputFile).toBe(rest.outputFile);
    else expect(fixture).not.toHaveProperty('outputFile');
  });

  it.each([
    { provider: 'claude-code-cli', layer: 'payload', length: 7 },
    { provider: 'codex-cli', layer: 'payload', length: 7 },
    { provider: 'claude-code-cli', layer: 'transport', length: 22 },
  ].flatMap(({ provider, layer, length }) => [0, length, -1, length + 1, 1.5, NaN, Infinity].map(keep => ({
    provider: provider as ProviderFixture['provider'], layer: layer as 'payload' | 'transport', keep,
  }))))('TEST-11 rejects $provider $layer keep=$keep', ({ provider, layer, keep }) => {
    expect(() => truncatedJson(provider, { a: 1 }, { layer, keep })).toThrow(RangeError);
  });

  it.each(providers)('TEST-11 rejects still-valid JSON cuts for %s', (provider) => {
    expect(() => truncatedJson(provider, 12, { keep: 1 })).toThrow(new Error('truncatedJson: the cut text is still valid JSON'));
  });

  it('TEST-11 rejects Codex transport truncation', () => {
    expect(() => truncatedJson('codex-cli', { a: 1 }, { layer: 'transport' })).toThrow(RangeError);
  });

  it.each(providers)('TEST-11 rejects undefined payloads for %s', (provider) => {
    expect(() => validResponse(provider, undefined)).toThrow(TypeError);
    expect(() => truncatedJson(provider, undefined)).toThrow(TypeError);
  });

  it.each(providers.flatMap(provider => [0, -1, 256, 1.5, NaN, Infinity].map(exitCode => ({ provider, exitCode }))))('TEST-11 rejects $provider exitCode=$exitCode', ({ provider, exitCode }) => {
    expect(() => nonZeroExit(provider, { exitCode })).toThrow(RangeError);
  });

  it.each(providers.flatMap(provider => [
    { provider, options: undefined, exitCode: 1, stderr: 'provider failed' },
    { provider, options: { exitCode: 1, stderr: '' }, exitCode: 1, stderr: '' },
    { provider, options: { exitCode: 255, stderr: 'custom failure' }, exitCode: 255, stderr: 'custom failure' },
  ]))('TEST-11 builds $provider nonZeroExit with code $exitCode and stderr "$stderr"', ({ provider, options, exitCode, stderr }) => {
    const fixture = nonZeroExit(provider, options);
    expect(fixture).toStrictEqual({ provider, provenance: { ambercast: version, input: expect.stringMatching(/^nonZeroExit\(/), origin: 'synthetic' }, run: { exitCode }, delayMs: 0, stdout: '', stderr });
    expect(ProviderFixtureValue.parse(fixture)).toStrictEqual(fixture);
  });

  it.each(providers)('TEST-11 builds payload-free hangs for %s', (provider) => {
    const fixture: ProviderFixture = hangUntilTimeout(provider);
    expect(fixture).toStrictEqual({ provider, provenance: { ambercast: version, input: expect.stringMatching(/^hangUntilTimeout\(/), origin: 'synthetic' }, run: { hang: true }, delayMs: 0, stdout: '', stderr: '' });
    expect(ProviderFixtureValue.parse(fixture)).toStrictEqual(fixture);
  });
});
