export function createMcpProgressSink(params: {
  readonly command: 'generate' | 'run' | 'heal';
  readonly sessionRoot: string;
  readonly send: (message: string) => Promise<void>;
  readonly onEvent?: (event: unknown) => void;
}): { emit: (event: unknown) => void; flush: () => Promise<void> } {
  throw new Error('not implemented');
}
