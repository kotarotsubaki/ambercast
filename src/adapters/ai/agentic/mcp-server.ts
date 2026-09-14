/** Hosts the loopback-only MCP transport for one agentic provider invocation. */

import { randomBytes } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { InstructionCriterionId, TraceAction, TraceAssert } from '#core/ir/schema.js';
import type { InstructionCoverageAiActionController } from '#ports/ai.js';

const PerformInput = z.strictObject({ action: TraceAction });
const EvaluateAssertInput = z.strictObject({
  check: TraceAssert,
  criterionId: InstructionCriterionId.optional(),
});
const SnapshotInput = z.strictObject({});

const tools = [
  { name: 'ambercast_perform', inputSchema: z.toJSONSchema(PerformInput) },
  { name: 'ambercast_evaluate_assert', inputSchema: z.toJSONSchema(EvaluateAssertInput) },
  { name: 'ambercast_snapshot', inputSchema: z.toJSONSchema(SnapshotInput) },
] as const;

/** Shared first-error state that makes all later calls fail closed. */
interface LatchState {
  error?: unknown;
  status?: number;
}

/**
 * Starts a token-authenticated MCP server on an ephemeral loopback port.
 *
 * The HTTP socket and first-error latch outlive individual requests. Every request
 * receives a new low-level MCP server and stateless transport because the SDK binds
 * one transport to a Server instance for its lifetime. The fresh pair shares the
 * controller and latch closures, preserving fail-closed dispatch across requests.
 */
export async function startAgenticMcpServer(
  controller: InstructionCoverageAiActionController,
): Promise<{
  readonly url: string;
  readonly token: string;
  awaitDrain(): Promise<void>;
  peekLatchedError(): unknown | undefined;
  close(): Promise<void>;
}> {
  const token = randomBytes(32).toString('base64url');
  const latch: LatchState = {};
  let activeRequests = 0;
  let closePromise: Promise<void> | undefined;
  let resolveDrain: (() => void) | undefined;
  let drainPromise: Promise<void> = Promise.resolve();

  const settleLatch = (error: unknown, status?: number): unknown => {
    if (latch.error !== undefined) return latch.error;

    latch.error = error;
    if (status !== undefined) latch.status = status;
    return error;
  };

  const beginRequest = () => {
    if (activeRequests === 0) {
      drainPromise = new Promise<void>((resolve) => { resolveDrain = resolve; });
    }
    activeRequests += 1;
  };

  const endRequest = () => {
    activeRequests -= 1;
    if (activeRequests === 0) {
      resolveDrain?.();
      resolveDrain = undefined;
    }
  };

  const toolError = () => ({
    content: [{ type: 'text' as const, text: 'Agentic MCP request failed.' }],
    isError: true,
  });

  const createMcpServer = () => {
    const mcpServer = new Server(
      { name: 'ambercast-agentic', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (latch.error !== undefined) return toolError();

      const { name, arguments: arguments_ } = request.params;
      if (name === 'ambercast_perform') {
        const parsed = PerformInput.safeParse(arguments_);
        if (!parsed.success) {
          settleLatch(new IntegrityViolationError('The ambercast_perform input does not match the required schema.', {
            issues: parsed.error.issues,
          }));
          return toolError();
        }
        try {
          await controller.perform(parsed.data.action);
          return { content: [{ type: 'text' as const, text: 'null' }] };
        } catch (error) {
          settleLatch(error);
          return toolError();
        }
      }

      if (name === 'ambercast_evaluate_assert') {
        const parsed = EvaluateAssertInput.safeParse(arguments_);
        if (!parsed.success) {
          settleLatch(new IntegrityViolationError('The ambercast_evaluate_assert input does not match the required schema.', {
            issues: parsed.error.issues,
          }));
          return toolError();
        }
        try {
          const outcome = await controller.evaluateAssert(parsed.data.check, parsed.data.criterionId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(outcome) }] };
        } catch (error) {
          settleLatch(error);
          return toolError();
        }
      }

      if (name === 'ambercast_snapshot') {
        const parsed = SnapshotInput.safeParse(arguments_);
        if (!parsed.success) {
          settleLatch(new IntegrityViolationError('The ambercast_snapshot input does not match the required schema.', {
            issues: parsed.error.issues,
          }));
          return toolError();
        }
        try {
          const snapshot = await controller.snapshotForResolution();
          return { content: [{ type: 'text' as const, text: JSON.stringify(snapshot) }] };
        } catch (error) {
          settleLatch(error);
          return toolError();
        }
      }

      settleLatch(new Error('Unknown agentic MCP tool.'));
      return toolError();
    });

    return mcpServer;
  };

  const httpServer: HttpServer = createServer(async (request, response) => {
    beginRequest();
    let requestEnded = false;
    const finishRequest = () => {
      if (!requestEnded) {
        requestEnded = true;
        endRequest();
      }
    };
    response.once('finish', finishRequest);
    response.once('close', finishRequest);

    if (latch.status === 401) {
      response.statusCode = 401;
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      settleLatch(new Error('Unauthorized agentic MCP request.'), 401);
      response.statusCode = 401;
      response.end();
      return;
    }

    const mcpServer = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as never);
    try {
      await mcpServer.connect(transport as never);
      await transport.handleRequest(request, response);
    } catch (error) {
      settleLatch(error);
      if (!response.writableEnded) {
        response.statusCode = 500;
        response.end();
      }
    } finally {
      await mcpServer.close();
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    throw new Error('Agentic MCP server did not bind to a TCP address.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    awaitDrain: async () => drainPromise,
    peekLatchedError: () => latch.error,
    close: () => {
      if (closePromise !== undefined) return closePromise;
      closePromise = (async () => {
        await drainPromise;
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => error === undefined ? resolve() : reject(error));
        });
      })();
      return closePromise;
    },
  };
}
