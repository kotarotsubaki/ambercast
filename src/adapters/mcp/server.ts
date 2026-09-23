import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from './types.js';

export function createMcpServer(deps: McpServerDeps): { connect: (transport: unknown) => Promise<void>; close: () => Promise<void> } {
  throw new Error('not implemented');
}
