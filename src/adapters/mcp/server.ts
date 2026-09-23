import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDeps } from './types.js';
import {
  generateInputSchema,
  runInputSchema,
  checkInputSchema,
  healInputSchema,
} from './tool-schemas.js';
import {
  GENERATE_DESCRIPTION,
  RUN_DESCRIPTION,
  CHECK_DESCRIPTION,
  HEAL_DESCRIPTION,
} from './descriptions.js';
import { renderToolResult } from './render.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

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
 *
 * FIFO serialization (B8): All tool calls are serialized through a single Promise
 * chain. When a call is cancelled (extra.signal.aborted), it is removed from the
 * queue and does not prevent subsequent calls from executing.
 */
export function createMcpServer(deps: McpServerDeps): { connect: (transport: unknown) => Promise<void>; close: () => Promise<void> } {
  const mcpServer = new McpServer(
    { name: 'ambercast', version: deps.version },
    { instructions: 'Ambercast MCP server' }
  );

  let queue: Promise<unknown> = Promise.resolve();

  const createQueuedHandler = (
    toolName: 'generate' | 'run' | 'check' | 'heal',
    capability: 'generate' | 'run' | 'check' | 'healPreview'
  ) => {
    return (args: unknown, extra: { signal?: AbortSignal }): Promise<{ isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: { [key: string]: unknown } | undefined; _meta: Record<string, unknown> }> => {
      if (extra.signal?.aborted) {
        return Promise.reject(new Error('Aborted'));
      }

      // Schemas leave allowEmpty optional for clients; command capabilities receive the shared default.
      const input = args as Record<string, unknown>;
      const inputWithDefault = input.allowEmpty === undefined
        ? { ...input, allowEmpty: false }
        : input;

      const task = new Promise<{ isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: { [key: string]: unknown } | undefined; _meta: Record<string, unknown> }>((resolve, reject) => {
        const run = async () => {
          if (extra.signal?.aborted) {
            reject(new Error('Aborted'));
            return;
          }
          try {
            const result = await deps[capability](inputWithDefault);
            const rendered = renderToolResult(toolName, result);
            resolve(rendered as { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: { [key: string]: unknown } | undefined; _meta: Record<string, unknown> });
          } catch (err) {
            reject(err);
          }
        };

        queue = queue.then(run, run);
      });

      return task;
    };
  };

  mcpServer.registerTool('ambercast_generate', {
    description: GENERATE_DESCRIPTION,
    inputSchema: generateInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, (args, extra) => createQueuedHandler('generate', 'generate')(args, extra));

  mcpServer.registerTool('ambercast_run', {
    description: RUN_DESCRIPTION,
    inputSchema: runInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, (args, extra) => createQueuedHandler('run', 'run')(args, extra));

  mcpServer.registerTool('ambercast_check', {
    description: CHECK_DESCRIPTION,
    inputSchema: checkInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, (args, extra) => createQueuedHandler('check', 'check')(args, extra));

  mcpServer.registerTool('ambercast_heal', {
    description: HEAL_DESCRIPTION,
    inputSchema: healInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    _meta: { 'anthropic/requiresUserInteraction': true },
  }, (args, extra) => createQueuedHandler('heal', 'healPreview')(args, extra));

  return {
    connect: (transport: unknown) => mcpServer.connect(transport as Transport),
    close: () => mcpServer.close(),
  };
}
