/**
 * Capabilities supplied to the MCP adapter by runtime composition.
 *
 * @remarks
 * The adapter owns this structural contract rather than importing runtime
 * command types. Keeping inputs and envelopes opaque preserves the one-way
 * runtime-to-adapter dependency while allowing each tool to share the same
 * invocation boundary. The resolved session root, package version, and
 * progress stream are injected so SDK code need not read process globals.
 * The server.ts tool handlers validate and normalize generate, run, check, and
 * healPreview inputs with their corresponding zod schemas before passing them
 * as unknown to these capabilities. This dependency contract alone does not
 * establish input validity. Each unknown envelope remains opaque until
 * renderToolResult in render.ts interprets it.
 */
export interface McpProgressContext {
  readonly progressToken: string | number | undefined;
  readonly sendNotification: (notification: { readonly method: string; readonly params?: Record<string, unknown> }) => Promise<void>;
}

export interface McpServerDeps {
  readonly sessionRoot: string;
  readonly version: string;
  readonly stderr: NodeJS.WritableStream;
  /** The signal interrupts this job's execution, including a job_cancel request. */
  readonly generate: (input: unknown, progress: McpProgressContext, signal?: AbortSignal) => Promise<{ exitCode: number; envelope: unknown }>;
  /** The signal interrupts this job's execution, including a job_cancel request. */
  readonly run: (input: unknown, progress: McpProgressContext, signal?: AbortSignal) => Promise<{ exitCode: number; envelope: unknown }>;
  readonly check: (input: unknown, progress: McpProgressContext) => Promise<{ exitCode: number; envelope: unknown }>;
  /** The signal interrupts this job's execution, including a job_cancel request. */
  readonly healPreview: (input: unknown, progress: McpProgressContext, signal?: AbortSignal) => Promise<{ exitCode: number; envelope: unknown }>;
}
