export interface RunMcpCommandInput {
  readonly dir: string;
  readonly syncWaitMs: number;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

export async function runMcpCommand(input: RunMcpCommandInput): Promise<number> {
  throw new Error('not implemented');
}
