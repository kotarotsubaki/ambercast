import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createInteractiveSecretConsent } from '#runtime/secret-consent.js';
import type { ConsentRequest } from '#usecases/generate.js';

function request(): ConsentRequest {
  return {
    configPath: '/workspace/ambercast.config.json',
    items: [{
      file: 'a\\n.test.md',
      uses: [{ name: 'token\\u0000', stepId: 'fill-token', ref: '{{secrets.token}}', selectionSource: 'hint', envVar: 'AMBERCAST_SECRET_TOKEN' }],
    }],
    validateRenames: () => ({ ok: true }),
  } as unknown as ConsentRequest;
}

function requestWithItems(): ConsentRequest {
  return {
    configPath: '/workspace/ambercast.config.json',
    items: [
      { file: 'z.test.md', uses: [
        { name: 'second', stepId: 'step-z', ref: '{{secrets.second}}', selectionSource: 'hint', envVar: 'SECOND' },
        { name: 'first', stepId: 'step-a', ref: '{{secrets.first}}', selectionSource: 'hint', envVar: 'FIRST' },
      ] },
      { file: 'a.test.md', uses: [
        { name: 'third', stepId: 'step-b', ref: '{{secrets.third}}', selectionSource: 'hint', envVar: 'THIRD' },
      ] },
    ],
    validateRenames: () => ({ ok: true }),
  } as unknown as ConsentRequest;
}

function captureOutput(stream: PassThrough): { readonly text: () => string } {
  let value = '';
  stream.on('data', (chunk) => { value += chunk.toString(); });
  return { text: () => value };
}

describe('createInteractiveSecretConsent', () => {
  it('short-circuits non-interactive execution without consuming input or writing output', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outputText = '';
    output.on('data', (chunk) => { outputText += chunk.toString(); });
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => false });

    await expect(consent(request())).resolves.toEqual({ kind: 'not-interactive' });
    expect(outputText).toBe('');
  });

  it('presents every dynamic field through displayLine before accepting an individual decision', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outputText = '';
    output.on('data', (chunk) => { outputText += chunk.toString(); });
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(request());
    input.end('y\\n');

    await expect(pending).resolves.toEqual({ kind: 'allowed', renames: [] });
    expect(outputText).toContain('a\\x0A.test.md');
    expect(outputText).toContain('token\\x00');
  });

  it.each(['y', 'yes'] as const)('accepts every remaining item globally for %s', async (answer) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const captured = captureOutput(output);
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(requestWithItems());
    input.end(`${answer}\n`);

    await expect(pending).resolves.toEqual({ kind: 'allowed', renames: [] });
    expect(captured.text()).toContain('z.test.md');
    expect(captured.text()).toContain('a.test.md');
  });

  it('enters individual edit mode and returns the accepted rename', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(request());
    input.end('i\nrenamed_token\n');

    await expect(pending).resolves.toEqual({
      kind: 'allowed',
      renames: [{ file: 'a\\n.test.md', name: 'token\\u0000', newName: 'renamed_token' }],
    });
  });

  it('treats an uppercase N and EOF as declined decisions that discard edits', async () => {
    for (const answer of ['N\\n', '']) {
      const input = new PassThrough();
      const output = new PassThrough();
      const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
      const pending = consent(request());
      input.end(answer);
      await expect(pending).resolves.toEqual({ kind: 'declined' });
    }
  });

  it('asks individual items in first selected occurrence order, then first appearance in each file', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const captured = captureOutput(output);
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(requestWithItems());
    input.end('y\ny\ny\n');

    await expect(pending).resolves.toEqual({ kind: 'allowed', renames: [] });
    const text = captured.text();
    expect(text.indexOf('z.test.md')).toBeLessThan(text.indexOf('a.test.md'));
    expect(text.indexOf('second')).toBeLessThan(text.indexOf('first'));
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('third'));
  });

  it('replays a read-only item after a rename attempt and accepts only keep or decline on replay', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const captured = captureOutput(output);
    const validateRenames = (renames: readonly unknown[]) => (
      renames.length === 0 ? { ok: true } : { ok: false, failedKeys: [{ file: 'a\\n.test.md', name: 'token\\u0000' }] }
    );
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent({ ...request(), validateRenames } as ConsentRequest);
    input.end('renamed\ny\n');

    await expect(pending).resolves.toEqual({ kind: 'allowed', renames: [] });
    expect(captured.text()).toMatch(/read-only/i);
  });

  it('treats case-insensitive global N as rejection rather than a rename value', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(requestWithItems());
    input.end('N\n');

    await expect(pending).resolves.toEqual({ kind: 'declined' });
  });

  it('discards every prior edit when EOF occurs before the individual protocol completes', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(requestWithItems());
    input.end('replacement\n');

    await expect(pending).resolves.toEqual({ kind: 'declined' });
  });

  it.each(['N\n', ''] as const)('discards all accepted edits after a later %s in individual mode', async (terminalAnswer) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const consent = createInteractiveSecretConsent({ input, output, isInteractive: () => true });
    const pending = consent(requestWithItems());
    input.end(`i\nsecond_renamed\n${terminalAnswer}`);

    await expect(pending).resolves.toEqual({ kind: 'declined' });
  });
});
