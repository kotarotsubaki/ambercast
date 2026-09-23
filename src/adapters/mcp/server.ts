import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ProgressNotification } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { McpServerDeps } from './types.js';
import { generateInputSchema, runInputSchema, checkInputSchema, healInputSchema } from './tool-schemas.js';
import { GENERATE_DESCRIPTION, RUN_DESCRIPTION, CHECK_DESCRIPTION, HEAL_DESCRIPTION } from './descriptions.js';
import { renderJobRecord, renderToolResult } from './render.js';

type Tool = 'generate' | 'run' | 'heal';
type Capability = 'generate' | 'run' | 'healPreview';
type Result = { exitCode: number; envelope: unknown };
type Response = { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: { [key: string]: unknown } | undefined; _meta: Record<string, unknown> };
type Extra = { signal?: AbortSignal; _meta?: { progressToken?: string | number | undefined }; sendNotification: (notification: ProgressNotification) => Promise<void> };
type RecordData = {
  jobId: string; tool: Tool; status: 'working' | 'completed' | 'failed' | 'cancelled';
  statusMessage: string; progress: number; createdAt: string; lastUpdatedAt: string;
  pollIntervalMs: number; ttlMs: number;
};
type Job = {
  record: RecordData; controller: AbortController; queued: boolean;
  result?: Result; error?: unknown; terminalAt?: number;
  done: Promise<void>; finish: () => void;
};

const statusInput = z.object({ jobId: z.string().min(1).optional(), waitMs: z.number().int().min(0).max(10_000).optional() }).strict();
const cancelInput = z.object({ jobId: z.string().min(1) }).strict();

/**
 * Creates the MCP tool host from runtime-supplied capabilities.
 *
 * @param deps - Command capabilities and session-scoped values supplied by runtime.
 * @param options - Shutdown signal and synchronous response wait policy.
 * @returns Transport lifecycle operations for the caller.
 * @remarks
 * Write jobs use one FIFO, while check and job inspection remain independent.
 * Records live only for this server session and expire after terminal retention.
 */
export function createMcpServer(deps: McpServerDeps, options?: { readonly signal?: AbortSignal; readonly syncWaitMs?: number }): { connect: (transport: unknown) => Promise<void>; close: () => Promise<void> } {
  const mcpServer = new McpServer(
    { name: 'ambercast', version: deps.version },
    { instructions: 'Use this server to run and repair keystroke E2E tests with ambercast. Use generate to create plans, run to replay them, check to validate them, and heal to preview repairs. For longer work, use job_status to collect results or job_cancel to stop a job.' }
  );
  const jobs = new Map<string, Job>();
  let queue: Promise<void> = Promise.resolve();

  const response = (value: ReturnType<typeof renderToolResult> | ReturnType<typeof renderJobRecord>): Response => value as Response;
  const snapshot = (job: Job): RecordData => {
    if (job.queued && job.record.status === 'working') {
      const ahead = [...jobs.values()].filter((other) => other !== job && other.record.status === 'working' && [...jobs.keys()].indexOf(other.record.jobId) < [...jobs.keys()].indexOf(job.record.jobId));
      return { ...job.record, statusMessage: `queued behind ${ahead.length}` };
    }
    return { ...job.record };
  };
  const prune = (): void => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.terminalAt !== undefined && now - job.terminalAt >= job.record.ttlMs) jobs.delete(id);
    }
  };
  const missing = (id: string): Response => ({ isError: true, content: [{ type: 'text', text: `JOB_NOT_FOUND: ${id}` }], structuredContent: undefined, _meta: {} });
  const failed = (job: Job): Response => ({ isError: true, content: [{ type: 'text', text: `JOB_FAILED: ${job.record.jobId}` }], structuredContent: undefined, _meta: { job: snapshot(job) } });
  const terminal = (job: Job): Response => {
    if (job.error !== undefined || job.result === undefined) return failed(job);
    const rendered = renderToolResult(job.record.tool, job.result);
    return response({ ...rendered, _meta: { ...rendered._meta, job: snapshot(job) } });
  };
  const settle = (job: Job, status: RecordData['status']): void => {
    job.record.status = status;
    job.record.statusMessage = status === 'cancelled' && job.queued ? 'cancelled before start' : status;
    job.record.lastUpdatedAt = new Date().toISOString();
    job.terminalAt = Date.now();
    job.finish();
  };
  const wait = async (job: Job, ms: number): Promise<boolean> => {
    if (job.record.status !== 'working') return true;
    if (ms === 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        job.done.then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const cancel = async (job: Job): Promise<Response> => {
    if (job.record.status !== 'working') return response(renderJobRecord(snapshot(job)));
    if (job.queued) {
      settle(job, 'cancelled');
      return response(renderJobRecord(snapshot(job)));
    }
    job.controller.abort();
    const finished = await wait(job, 10_000);
    if (!finished && job.record.status === 'working') {
      job.record.statusMessage = 'cancel requested';
      job.record.lastUpdatedAt = new Date().toISOString();
    }
    return response(renderJobRecord(snapshot(job)));
  };

  const start = (tool: Tool, capability: Capability, args: Record<string, unknown>, extra: Extra): Job => {
    const now = new Date().toISOString();
    const jobId = randomUUID();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const job: Job = {
      record: { jobId, tool, status: 'working', statusMessage: 'running', progress: 0,
        createdAt: now, lastUpdatedAt: now, pollIntervalMs: 2000, ttlMs: 1_800_000 },
      controller: new AbortController(), queued: true, done, finish,
    };
    jobs.set(jobId, job);
    queue = queue.then(async () => {
      if (job.record.status !== 'working') return;
      if (options?.signal?.aborted || extra.signal?.aborted) {
        settle(job, 'cancelled');
        return;
      }
      job.queued = false;
      const realProgressToken = extra._meta?.progressToken;
      // The internal token creates the runtime event sink; only the real token may leave over MCP.
      const progressToken = realProgressToken ?? jobId;
      try {
        job.result = await deps[capability](args, {
          progressToken,
          sendNotification: async (notification) => {
            if (notification.method === 'internal/run-event') {
              job.record.progress += 1;
              job.record.lastUpdatedAt = new Date().toISOString();
              if (job.record.status === 'working') job.record.statusMessage = `progress: ${job.record.progress}`;
            } else if (realProgressToken !== undefined) {
              await extra.sendNotification({ ...notification, params: { ...notification.params, progressToken: realProgressToken } } as ProgressNotification);
            }
          },
        }, job.controller.signal);
        const envelope = job.result.envelope;
        const errors = typeof envelope === 'object' && envelope !== null && 'errors' in envelope ? envelope.errors : undefined;
        const interrupted = Array.isArray(errors) && errors.some((error: unknown) => typeof error === 'object' && error !== null && 'scope' in error && 'code' in error && error.scope === 'run' && error.code === 'INTERRUPTED');
        settle(job, interrupted ? 'cancelled' : 'completed');
      } catch (error) {
        job.error = error;
        settle(job, 'failed');
      }
    });
    return job;
  };

  const write = (tool: Tool, capability: Capability) => async (args: Record<string, unknown>, extra: Extra): Promise<Response> => {
    if (extra.signal?.aborted) throw new Error('Aborted');
    prune();
    const input = args.allowEmpty === undefined ? { ...args, allowEmpty: false } : args;
    const job = start(tool, capability, input, extra);
    if (await wait(job, options?.syncWaitMs ?? 45_000)) {
      if (job.record.status === 'cancelled' && job.result === undefined) {
        return { isError: true, content: [{ type: 'text', text: 'Aborted' }], structuredContent: undefined, _meta: {} };
      }
      return terminal(job);
    }
    return response(renderJobRecord(snapshot(job)));
  };

  mcpServer.registerTool('ambercast_generate', {
    description: GENERATE_DESCRIPTION, inputSchema: generateInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, write('generate', 'generate'));
  mcpServer.registerTool('ambercast_run', {
    description: RUN_DESCRIPTION, inputSchema: runInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, write('run', 'run'));
  mcpServer.registerTool('ambercast_check', {
    description: CHECK_DESCRIPTION, inputSchema: checkInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, extra) => {
    if (extra.signal?.aborted || options?.signal?.aborted) throw new Error('Aborted');
    const input = args.allowEmpty === undefined ? { ...args, allowEmpty: false } : args;
    return response(renderToolResult('check', await deps.check(input, {
      progressToken: extra._meta?.progressToken,
      sendNotification: (notification) => extra.sendNotification(notification as ProgressNotification),
    })));
  });
  mcpServer.registerTool('ambercast_heal', {
    description: HEAL_DESCRIPTION, inputSchema: healInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { 'anthropic/requiresUserInteraction': true },
  }, write('heal', 'healPreview'));
  mcpServer.registerTool('ambercast_job_status', {
    description: 'Ambercast job status: inspect a write job. Optional input jobId selects one job; waitMs waits for completion.',
    inputSchema: statusInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ jobId, waitMs }) => {
    prune();
    if (jobId === undefined) return { isError: false, content: [{ type: 'text' as const, text: JSON.stringify([...jobs.values()].map(snapshot)) }], structuredContent: { jobs: [...jobs.values()].map(snapshot) }, _meta: {} };
    const job = jobs.get(jobId);
    if (job === undefined) return missing(jobId);
    await wait(job, waitMs ?? 0);
    return job.record.status === 'working' || (job.record.status === 'cancelled' && job.result === undefined)
      ? response(renderJobRecord(snapshot(job))) : terminal(job);
  });
  mcpServer.registerTool('ambercast_job_cancel', {
    description: 'Ambercast job cancel: request cancellation of a write job. Required input jobId identifies the job.',
    inputSchema: cancelInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ jobId }) => {
    prune();
    const job = jobs.get(jobId);
    return job === undefined ? missing(jobId) : cancel(job);
  });

  options?.signal?.addEventListener('abort', () => {
    for (const job of jobs.values()) {
      if (job.record.status !== 'working') continue;
      if (job.queued) settle(job, 'cancelled');
      else job.controller.abort();
    }
  }, { once: true });

  return { connect: (transport: unknown) => mcpServer.connect(transport as Transport), close: () => mcpServer.close() };
}
