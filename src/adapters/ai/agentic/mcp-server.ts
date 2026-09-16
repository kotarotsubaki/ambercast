/** Hosts the loopback-only MCP transport for one agentic provider invocation. */

import { randomBytes } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { InstructionCriterionId, TraceAction, TraceAssert } from '#core/ir/schema.js';
import { redactDynamicPathSegments } from '#core/ai/response-issue-path.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import type { InstructionCoverageAiActionController } from '#ports/ai.js';

const PerformInput = z.strictObject({ action: TraceAction });
const EvaluateAssertInput = z.strictObject({
  check: TraceAssert,
  criterionId: InstructionCriterionId.optional(),
});
const SnapshotInput = z.strictObject({});

const tools = [
  {
    name: 'ambercast_perform',
    description: 'Perform one browser action on the current page. The action object is discriminated by its type field: click {target}, press {target, key: Enter|Tab|Escape|ArrowDown|ArrowUp}, fill {target, value}, fill-secret {target, secretRef}, navigate {url}. Every target is {strategy: "accessibility", role, name} using the exact role and accessible name shown by ambercast_snapshot. Never place a secret value in fill; use fill-secret with the secretRef declared for this step, written as {{secrets.NAME}}.',
    inputSchema: z.toJSONSchema(PerformInput),
  },
  {
    name: 'ambercast_evaluate_assert',
    description: 'Evaluate one assertion against the current page and return whether it passed. The check object always has type: "assert" and is discriminated by its check field: text-visible {text}, element-visible {target}, text-equals {target, text}, url-matches {pattern}, element-count {target, count}. Every target is {strategy: "accessibility", role, name} from ambercast_snapshot. Pass criterionId (the id of a trusted success criterion for this step) only on the terminal assertion that proves that criterion; omit it for intermediate checks.',
    inputSchema: z.toJSONSchema(EvaluateAssertInput),
  },
  {
    name: 'ambercast_snapshot',
    description: 'Return the current page\'s accessibility snapshot (role and name tree). Call it before choosing a target so role and name match exactly. It takes no arguments.',
    inputSchema: z.toJSONSchema(SnapshotInput),
  },
] as const;

const AGENTIC_SCHEMA_REJECTION_LIMIT = 3;

type AgenticToolName = typeof tools[number]['name'];

const toolDescriptionByName: Record<AgenticToolName, string> = Object.fromEntries(
  tools.map((tool) => [tool.name, tool.description] as const),
) as Record<AgenticToolName, string>;

type SchemaMismatchIssue = {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly expected?: string;
  readonly values?: readonly unknown[];
  readonly keyCount?: number;
};

type AiResponseInvalidIssue = {
  readonly code: 'schema-mismatch';
  readonly path: readonly (string | number)[];
};

/**
 * Shared first-error state and the per-server schema rejection budget.
 *
 * The counter spans all three tools and never resets after a valid call, so
 * one case cannot evade its bounded correction budget by switching tools. Its
 * synchronous pre-await increment makes the increment-and-threshold decision
 * atomic in JavaScript's single-threaded execution without a mutex or queue.
 */
interface LatchState {
  error?: unknown;
  status?: number;
  schemaRejections: number;
}

/**
 * Projects schema-validation issues into the deliberately closed MCP result shape.
 *
 * The projection retains zod's issue order and duplicates. Its closed
 * allowlist appends `expected` for `invalid_type`, `values` for
 * `invalid_value`, or `keyCount` for `unrecognized_keys`; the count exposes
 * the number of extra keys, never their names. All other zod codes retain
 * only the base shape.
 *
 * It omits zod's `message` and `input`, together with an `invalid_union`'s
 * nested `errors`, `note`, and `discriminator`, because those values can echo an
 * agent-supplied value—including a secret mistakenly placed in a rejected field—
 * into the tool response the agent reads. `path` carries the raw zod path
 * without `redactDynamicPathSegments`: these three tool-input shapes have no
 * dynamic subtree roots comparable to
 * `generatorMeta` or `ambiguities` for that helper to redact.
 */
function toSchemaMismatchIssues(zodError: z.ZodError): readonly SchemaMismatchIssue[] {
  return zodError.issues.map((issue): SchemaMismatchIssue => {
    const base = { code: issue.code, path: issue.path };
    if (issue.code === 'invalid_type') return { ...base, expected: issue.expected };
    if (issue.code === 'invalid_value') return { ...base, values: issue.values };
    if (issue.code === 'unrecognized_keys') return { ...base, keyCount: issue.keys.length };
    return base;
  });
}

/**
 * Projects the terminal schema failure into the existing report-safe issue shape.
 *
 * Unlike the live MCP projection, which runs on every rejection, this
 * projection runs once when the fourth cumulative rejection settles the latch
 * and uses only that final rejection's zod issues. Each issue has the fixed
 * `{ code: 'schema-mismatch', path }` shape, with `path` produced by
 * applying `redactDynamicPathSegments` from `response-issue-path.ts` to the
 * rejected arguments and raw zod path. This reuses the AI-response redaction
 * contract already used by `response-validator.ts` rather than creating another.
 *
 * The live MCP result remains a distinct closed-allowlist response for the
 * calling agent, while this terminal projection serves `reportError()` through
 * `AiResponseInvalidError`. It deliberately omits `attempts`, since the caller
 * already observed its retry budget as `rejectionsRemaining` in the tool result.
 */
function toAiResponseInvalidIssues(
  zodError: z.ZodError,
  argumentsValue: unknown,
): readonly AiResponseInvalidIssue[] {
  return zodError.issues.map((issue) => ({
    code: 'schema-mismatch' as const,
    path: redactDynamicPathSegments(argumentsValue, issue.path),
  }));
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
  const latch: LatchState = { schemaRejections: 0 };
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

  /**
   * Handles a malformed tool payload at the common schema boundary.
   *
   * The terminal rejection settles an AiResponseInvalidError rather than an
   * IntegrityViolationError: this path reports a provider input mistake that
   * the caller can correct, not corruption of a reviewed artifact. Before that
   * terminal point, the helper returns a structured tool error and leaves the
   * latch available for later well-formed requests.
   *
   * Only the call that crosses the rejection limit needs special handling:
   * the handler's existing latch guard rejects every later call. Earlier calls
   * return the structured `isError: true` result, with the same hint as the
   * tool's `tools/list` description and no `attempts` field, so the caller
   * can correct its input without losing the remaining budget.
   *
   * The threshold-crossing call builds an AiResponseInvalidError from its own
   * `toAiResponseInvalidIssues` projection, settles the latch, and returns the
   * existing generic `toolError()` instead of the structured result.
   */
  const rejectSchema = (
    toolName: AgenticToolName,
    zodError: z.ZodError,
    argumentsValue: unknown,
  ): ReturnType<typeof toolError> => {
    latch.schemaRejections += 1;
    if (latch.schemaRejections > AGENTIC_SCHEMA_REJECTION_LIMIT) {
      settleLatch(new AiResponseInvalidError(
        `The ${toolName} input does not match the required schema after ${AGENTIC_SCHEMA_REJECTION_LIMIT} rejected calls.`,
        { issues: toAiResponseInvalidIssues(zodError, argumentsValue) },
      ));
      return toolError();
    }

    const rejectionsRemaining = AGENTIC_SCHEMA_REJECTION_LIMIT - latch.schemaRejections;
    const body = {
      error: 'schema-mismatch' as const,
      tool: toolName,
      issues: toSchemaMismatchIssues(zodError),
      rejectionsRemaining,
      hint: toolDescriptionByName[toolName],
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(body) }], isError: true };
  };

  const createMcpServer = () => {
    const mcpServer = new Server(
      { name: 'ambercast-agentic', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (latch.error !== undefined) return toolError();

      const { name } = request.params;
      // Only an omitted arguments member is an empty object. An explicit null
      // remains invalid input so the transport does not silently widen its
      // contract beyond the MCP omission case.
      const arguments_ = request.params.arguments === undefined ? {} : request.params.arguments;
      if (name === 'ambercast_perform') {
        const parsed = PerformInput.safeParse(arguments_);
        if (!parsed.success) {
          return rejectSchema(name, parsed.error, arguments_);
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
          return rejectSchema(name, parsed.error, arguments_);
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
          return rejectSchema(name, parsed.error, arguments_);
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
