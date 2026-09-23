/**
 * Converts a command result into the shared MCP tool response shape.
 *
 * @param tool - Tool whose response policy applies.
 * @param result - Runtime status and rendering-neutral report envelope.
 * @param applyToken - Optional authorization token for a later heal apply call.
 * @returns Text and structured content with transport error and metadata fields.
 * @remarks
 * One renderer will keep error classification and content, structured content,
 * and metadata construction consistent across tools. Heal preview issues no
 * apply token; the optional parameter reserves the same response contract for
 * the later apply operation without making preview grant write authority.
 */
export function renderToolResult(
  tool: 'generate' | 'run' | 'check' | 'heal',
  result: { readonly exitCode: number; readonly envelope: unknown },
  applyToken?: string,
): { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: unknown; _meta: Record<string, unknown> } {
  throw new Error('not implemented');
}
