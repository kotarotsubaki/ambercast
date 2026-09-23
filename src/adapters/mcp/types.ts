/**
 * Capabilities supplied to the MCP adapter by runtime composition.
 *
 * @remarks
 * The adapter owns this structural contract rather than importing runtime
 * command types. Keeping inputs and envelopes opaque preserves the one-way
 * runtime-to-adapter dependency while allowing each tool to share the same
 * invocation boundary. The resolved session root, package version, and
 * progress stream are injected so SDK code need not read process globals.
 */
export interface McpServerDeps {
  readonly sessionRoot: string;
  readonly version: string;
  readonly stderr: NodeJS.WritableStream;
  readonly generate: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly run: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly check: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly healPreview: (input: unknown) => Promise<{ exitCode: number; envelope: unknown }>;
}
