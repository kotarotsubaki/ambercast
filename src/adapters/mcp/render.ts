export function renderToolResult(
  tool: 'generate' | 'run' | 'check' | 'heal',
  result: { readonly exitCode: number; readonly envelope: unknown },
  applyToken?: string,
): { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: unknown; _meta: Record<string, unknown> } {
  throw new Error('not implemented');
}
