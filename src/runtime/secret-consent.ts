import type { ConsentCapability } from '#usecases/generate.js';

export function createInteractiveSecretConsent(_deps: {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly isInteractive: () => boolean;
  readonly signal?: AbortSignal;
}): ConsentCapability['request'] {
  return async () => {
    throw new Error('not implemented');
  };
}
