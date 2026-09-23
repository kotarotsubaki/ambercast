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
 */
export function createMcpServer(deps: McpServerDeps): { connect: (transport: unknown) => Promise<void>; close: () => Promise<void> } {
  throw new Error('not implemented');
}
