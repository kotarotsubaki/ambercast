import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('provider replay conventions', () => {
  it('TEST-21 documents provider replay in Testing conventions', () => {
    const text = readFileSync(new URL('../../../AGENTS.md', import.meta.url), 'utf8');
    const section = text.split(/^## Testing conventions\s*$/m)[1]?.split(/^## /m)[0];
    expect(section).toBeDefined();
    for (const phrase of ['test/fixtures/corpus/provider-output/*.jsonl', 'ProviderFixtureValue', 'replayThroughUseCase', 'replayExecute', 'provider-fault-builders.ts', 'secrets', 'commit']) {
      expect(section).toContain(phrase);
    }
  });

  it('TEST-21 keeps the harness and support tests free of the spawn runner', () => {
    const support = new URL('.', import.meta.url);
    const files = [
      ...['provider-fixture.ts', 'provider-fault-builders.ts', 'provider-replay.ts'].map(name => new URL(`../../support/${name}`, import.meta.url)),
      ...readdirSync(support).filter(name => name.startsWith('provider-') && name.endsWith('.test.ts')).map(name => new URL(name, support)),
    ];
    const forbidden = ['createSpawn', 'CommandRunner'].join('');
    for (const file of files) expect(readFileSync(file, 'utf8'), file.pathname).not.toContain(forbidden);
  });

  it.each(['claude-code-cli', 'codex-cli'])('TEST-20 removes the inline live-schema case for %s', provider => {
    const source = readFileSync(new URL(`../adapters/ai/${provider}.test.ts`, import.meta.url), 'utf8');
    const oldName = ['accepts an AI step with an empty verification intent', 'through the live request schema'].join(' ');
    expect(source).not.toContain(oldName);
  });
});
