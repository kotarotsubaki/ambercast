/**
 * Converts a command result into the shared MCP tool response shape.
 *
 * @param tool - Tool whose response policy applies.
 * @param result - Runtime status and rendering-neutral report envelope.
 * @param applyToken - Optional authorization token for a later heal apply call.
 * @returns Text and structured content with transport error and metadata fields.
 * @remarks
 * One renderer keeps error classification and content, structured content,
 * and metadata construction consistent across tools. Heal preview issues no
 * apply token; the optional parameter reserves the same response contract for
 * the later apply operation without making preview grant write authority.
 * The result exitCode (from HealCommandOutput or an equivalent envelope)
 * determines isError: generate and check treat 2 or 3
 * as errors; run and heal treat 2, 3, or 4 as errors; all other codes are not
 * errors. The result contains exactly one text content item. Its first line is
 * `exitCode: <n>`, followed by `applyToken: <token>` only when supplied, then
 * `JSON.stringify(envelope)` on the following lines. structuredContent is the
 * envelope itself, and _meta.exitCode is its exitCode. The return shape can be
 * used directly by a registerTool callback without exposing SDK types.
 */
export function renderToolResult(
  tool: 'generate' | 'run' | 'check' | 'heal',
  result: { readonly exitCode: number; readonly envelope: unknown },
  applyToken?: string,
): { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: unknown; _meta: Record<string, unknown> } {
  const exitCode = result.exitCode;
  let isError = false;
  switch (tool) {
    case 'generate':
      isError = exitCode === 2 || exitCode === 3;
      break;
    case 'run':
      isError = exitCode === 2 || exitCode === 3 || exitCode === 4;
      break;
    case 'check':
      isError = exitCode === 2 || exitCode === 3;
      break;
    case 'heal':
      isError = exitCode === 2 || exitCode === 3 || exitCode === 4;
      break;
  }

  const lines = [`exitCode: ${exitCode}`];
  if (applyToken !== undefined) {
    lines.push(`applyToken: ${applyToken}`);
  }
  lines.push(JSON.stringify(result.envelope));

  return {
    isError,
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: result.envelope,
    _meta: { exitCode },
  };
}

/**
 * Renders a JobRecord into the shared MCP response shape for handle and
 * non-terminal status/cancel responses.
 *
 * @param record - The job record to render (unknown for defensive parsing).
 * @returns Text and structured content with transport error and metadata fields.
 * @remarks
 * Shared response shape for: (1) job handle returned at enqueue time for
 * async jobs, (2) non-terminal job_status responses, (3) queued-cancel
 * job_cancel responses. The record's status determines whether the job
 * is terminal (completed/failed/cancelled) or non-terminal (working).
 * Non-terminal records include statusMessage derived at read time (e.g.,
 * "queued behind N"). This function validates shape before rendering;
 * invalid records return isError: true with an error message.
 */
export function renderJobRecord(record: unknown): { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: unknown; _meta: Record<string, unknown> } {
  throw new Error('not implemented');
}
