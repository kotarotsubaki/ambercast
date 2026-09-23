export interface McpServerDeps {
  readonly sessionRoot: string;
  readonly version: string;
  readonly stderr: NodeJS.WritableStream;
  readonly generate: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly run: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly check: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly healPreview: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
}
