/**
 * Converts a command result into the shared MCP tool response shape.
 *
 * @param tool - Tool whose response policy applies.
 * @param result - Runtime status and rendering-neutral report envelope.
 * @param applyToken - Optional authorization token for a later heal apply call.
 * @returns Text and structured content with transport error and metadata fields.
 * @remarks
 * One renderer keeps error classification and content, structured content,
 * and metadata construction consistent across tools. A successful heal
 * preview carries the token issued by runtime composition; other tools and
 * heal apply calls do not issue one. Rendering a completed job can precede
 * client delivery when a synchronous call has returned a handle. This
 * renderer only constructs the response; the server marks first delivery
 * when its shared terminal response boundary returns the cached response.
 * Tool-specific exit codes determine transport error status. A preview token
 * appears in both text and metadata so clients can retrieve it from either
 * response surface. The return shape can be used directly by a registerTool
 * callback without exposing SDK types.
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
    // Delivery is marked when the server returns the terminal response.
    lines.push(`applyToken: ${applyToken}`);
  }
  lines.push(JSON.stringify(result.envelope));

  return {
    isError,
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: result.envelope,
    _meta: { exitCode, ...(applyToken === undefined ? {} : { applyToken }) },
  };
}

/**
 * Renders a job record for handle, status, and cancellation responses.
 *
 * @param record - The job record to render (unknown for defensive parsing).
 * @returns Text and structured content with transport error and metadata fields.
 * @remarks
 * Job handles, non-terminal job_status, job_cancel, and queued cancellation
 * share one record response contract. Terminal job_status responses for
 * completed or cancelled jobs retaining a result instead use the same
 * renderToolResult response format as the corresponding synchronous tool,
 * with the record attached at `_meta.job`. The job_status handler in
 * the server handler chooses between the two response formats.
 * Keeping the record contract here prevents its response formats from
 * drifting apart. A valid record yields isError: false,
 * structuredContent equal to the record, and _meta.jobId equal to its ID.
 * Its text always has exactly three lines: `jobId: <id>`,
 * `status: <status>`, and `<statusMessage>`, in that order. The status message
 * can express queue position without adding a queued status. Invalid records
 * yield isError: true with an error message.
 */
export function renderJobRecord(record: unknown): { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: unknown; _meta: Record<string, unknown> } {
  if (typeof record !== 'object' || record === null || !('jobId' in record) || !('status' in record) || !('statusMessage' in record)
    || typeof record.jobId !== 'string' || typeof record.status !== 'string' || typeof record.statusMessage !== 'string') {
    return { isError: true, content: [{ type: 'text', text: 'Invalid job record' }], structuredContent: undefined, _meta: {} };
  }
  return {
    isError: false,
    content: [{ type: 'text', text: `jobId: ${record.jobId}\nstatus: ${record.status}\n${record.statusMessage}` }],
    structuredContent: record,
    _meta: { jobId: record.jobId },
  };
}
