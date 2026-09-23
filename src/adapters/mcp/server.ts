import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from './types.js';

/**
 * Creates the MCP tool host from runtime-supplied capabilities.
 *
 * @param deps - Command capabilities and session-scoped values supplied by runtime.
 * @returns Transport lifecycle operations for the caller.
 * @remarks
 * SDK ownership stays inside this adapter. The narrow connect/close surface
 * prevents runtime composition from depending on the SDK server type or its
 * registration details.
 * The caller guarantees that connect receives an SDK Transport; this function
 * does not validate its type. SDK connection failures propagate to the caller.
 * close completes safely as a no-op before connection. Tool input validation
 * belongs to registerTool's inputSchema in tool-schemas.ts, not this function.
 */
export function createMcpServer(deps: McpServerDeps): { connect: (transport: unknown) => Promise<void>; close: () => Promise<void> } {
  throw new Error('not implemented');
}
