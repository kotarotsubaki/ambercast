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

/**
 * Outcome of a heal apply request.
 *
 * @remarks
 * `kind: 'report'` contains the normal heal result after a proposal reaches
 * settlement, including declined or interrupted confirmation. `kind: 'error'`
 * contains a typed token or settlement failure. An unknown, superseded,
 * expired, or already consumed token that cannot be replayed returns error
 * without invoking settlement. The apply path selects report only when a valid
 * proposal produces a settled heal result; otherwise it returns error.
 */
export type ToolOutcome =
  | { readonly kind: 'report'; readonly exitCode: number; readonly envelope: unknown }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

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
  readonly healPreview: (input: unknown, progress: McpProgressContext, signal?: AbortSignal) => Promise<{ exitCode: number; envelope: unknown; applyToken?: string }>;
  /**
   * Starts a proposal's pending TTL when its token-bearing terminal response
   * is first returned to the client, by either synchronous heal preview or
   * terminal job_status. Completion and cache rendering do not count as
   * delivery. Repeated calls for the same token leave deliveredAt unchanged.
   */
  readonly markHealDelivered?: (token: string) => void;
  /** Consumes a pending token before confirmation and FIFO admission. */
  readonly beginHealApply?: (token: string, signal?: AbortSignal) => Promise<{ proceed: true; cases: readonly { readonly file: string; readonly healingSummary: string }[] } | { proceed: false; outcome: ToolOutcome }>;
  /** Settles a consumed token once after confirmation, or as interrupted on abort. */
  readonly settleHealApply?: (token: string, confirm: 'authorized' | 'declined' | 'interrupted', signal?: AbortSignal, progress?: McpProgressContext) => Promise<ToolOutcome>;
  /** Publishes a consumed token's output after its first response renders. */
  readonly finalizeHealApply?: (token: string) => Promise<void> | void;
  /** Stores a sanitized, replayable error after an unexpected apply failure. */
  readonly failHealApply?: (token: string, error: unknown) => Promise<ToolOutcome>;
  /** Compatibility entry point for callers that combine consumption and settlement. */
  readonly applyHeal?: (token: string, confirm: 'authorized' | 'declined' | 'interrupted', signal?: AbortSignal) => Promise<ToolOutcome>;
}
