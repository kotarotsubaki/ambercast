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
});
