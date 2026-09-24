import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ProgressNotification } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { McpServerDeps, ToolOutcome } from './types.js';
import { generateInputSchema, runInputSchema, checkInputSchema, healInputSchema } from './tool-schemas.js';
import { GENERATE_DESCRIPTION, RUN_DESCRIPTION, CHECK_DESCRIPTION, HEAL_DESCRIPTION } from './descriptions.js';
import { renderJobRecord, renderToolResult } from './render.js';

type Tool = 'generate' | 'run' | 'heal';
type Capability = 'generate' | 'run' | 'healPreview' | 'applyHeal';
type Result = { exitCode: number; envelope: unknown; applyToken?: string };
type JobClock = { now(): Date; monotonicMs(): number };
type Response = { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: { [key: string]: unknown } | undefined; _meta: Record<string, unknown> };
type Extra = { signal?: AbortSignal; _meta?: { progressToken?: string | number | undefined }; sendNotification: (notification: ProgressNotification) => Promise<void> };
type RecordData = {
  jobId: string; tool: Tool; status: 'working' | 'completed' | 'failed' | 'cancelled';
  statusMessage: string; progress: number; createdAt: string; lastUpdatedAt: string;
  pollIntervalMs: number; ttlMs: number;
};
type Job = {
  record: RecordData; controller: AbortController; queued: boolean;
  applyToken?: string; cancelling?: Promise<void>;
  result?: Result; error?: unknown; terminalAt?: number; handleReturned?: boolean;
  rendered?: ReturnType<typeof renderToolResult>;
  delivered?: boolean;
  done: Promise<void>; finish: () => void;
};

/**
 * Proposal delivery is distinct from preparation completion. The eventual
 * apply path uses the same write FIFO and JobStore as other writes, so abort
 * while queued consumes and interrupts its proposal before cancelling its Job.
 * Runtime settlement receives interrupted to settle the consumed
 * proposal without starting an authorized write. While confirmation is
 * pending, the Job remains working; abort likewise passes interrupted to
 * runtime settlement and finishes the Job as cancelled. Once authorized
 * settlement has begun, the Job remains working until the runtime result
 * arrives; abort cannot reverse that write or invoke settlement again, and
 * the result determines its terminal record and response. Consumption precedes
 * elicitation; accept with confirm=true authorizes; an unconfirmed accept or
 * decline declines; cancel, timeout, and abort interrupt. Without
 * form elicitation capability, authorization proceeds directly. An abort
 * after authorized settlement begins cannot reverse its write. This adapter
 * owns SDK interaction and queue order while runtime owns preparation and
 * settlement through McpServerDeps.
 */
type HealConfirm = 'authorized' | 'declined' | 'interrupted';

const statusInput = z.object({ jobId: z.string().min(1).optional(), waitMs: z.number().int().min(0).max(45_000).optional() }).strict();
const cancelInput = z.object({ jobId: z.string().min(1) }).strict();

/**
 * Creates the MCP tool host from runtime-supplied capabilities.
 *
 * @param deps - Command capabilities and session-scoped values supplied by runtime.
 * @param options - Shutdown signal, synchronous response wait policy, and clock.
 * @returns Transport lifecycle operations for the caller.
 * @remarks
 * Write jobs use one FIFO, while check and job inspection remain independent.
 * Records live only for this server session and expire after terminal retention.
 */
export function createMcpServer(deps: McpServerDeps, options: { readonly signal?: AbortSignal; readonly syncWaitMs?: number; readonly clock: JobClock }): { connect: (transport: unknown) => Promise<void>; close: () => Promise<void> } {
  const mcpServer = new McpServer(
    { name: 'ambercast', version: deps.version },
    { instructions: 'Use this server to run and repair keystroke E2E tests with ambercast. Use generate to create plans, run to replay them, check to validate them, and heal to preview repairs. For longer work, use job_status to collect results or job_cancel to stop a job.' }
  );
  const clock = options.clock;
  const jobs = new Map<string, Job>();
  /** Confirms only after the heal apply job reaches the front of the FIFO. */
  const confirmHeal = async (signal?: AbortSignal): Promise<HealConfirm> => {
    const elicitationForm = mcpServer.server.getClientCapabilities()?.elicitation?.form;
    if (elicitationForm === undefined) {
      return 'authorized';
    }
    try {
      const result = await mcpServer.server.elicitInput({
        mode: 'form',
        message: 'Heal apply: confirm that you want to apply the proposed repairs?',
        requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
      }, { timeout: 600_000, ...(signal === undefined ? {} : { signal }) });
      if (result.action === 'cancel') {
        return 'interrupted';
      }
      if (result.action === 'decline') {
        return 'declined';
      }
      if (result.action === 'accept' && result.content?.confirm === true) {
        return 'authorized';
      }
      return 'declined';
    } catch {
      return 'interrupted';
    }
  };
  /** Creates an apply job through the existing write queue and record store. */
  const applyHeal = async (token: string, extra: Extra): Promise<Response> => {
    prune();
    const job = start('heal', 'applyHeal', { applyToken: token }, extra);
    const outcome = await wait(job, options?.syncWaitMs ?? 45_000, extra.signal);
    if (outcome === 'aborted') {
      await cancel(job);
      return response(renderJobRecord(snapshot(job)));
    }
    if (outcome === 'done') {
      if (job.record.status === 'cancelled' && job.result === undefined) {
        return { isError: true, content: [{ type: 'text', text: 'Aborted' }], structuredContent: undefined, _meta: {} };
      }
      if (job.error !== undefined || job.rendered === undefined) return failed(job);
      return terminal(job);
    }
    job.handleReturned = true;
    return response(renderJobRecord(snapshot(job)));
  };
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
    const now = clock.monotonicMs();
    for (const [id, job] of jobs) {
      if (job.terminalAt !== undefined && now - job.terminalAt >= job.record.ttlMs) jobs.delete(id);
    }
  };
  const missing = (id: string): Response => ({ isError: true, content: [{ type: 'text', text: `JOB_NOT_FOUND: ${id}` }], structuredContent: undefined, _meta: {} });
  const failed = (job: Job): Response => {
    const error = job.error;
    const name = typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : 'Error';
    return { isError: true, content: [{ type: 'text', text: `JOB_FAILED: the job crashed unexpectedly (${name})` }], structuredContent: undefined, _meta: { job: snapshot(job) } };
  };
  /**
   * The synchronous write and terminal job_status paths share this delivery
   * boundary. A completed job caches rendering inside the queue's try/catch
   * so a render exception becomes failed before completion is published.
   * That cache is not delivery: a handle may have been returned before the
   * token-bearing response is read. Only when returning that cached response
   * does this boundary call deps.markHealDelivered for its applyToken.
   * Repeated terminal reads are safe because the proposal store preserves
   * the first deliveredAt and treats subsequent marks as no-ops.
   */
  const terminal = (job: Job): Response => {
    if (job.error !== undefined || job.rendered === undefined) return failed(job);
    const rendered = job.rendered;
    if (job.result?.applyToken !== undefined && !job.delivered) {
      deps.markHealDelivered?.(job.result.applyToken);
      job.delivered = true;
    }
    return response({ ...rendered, _meta: { ...rendered._meta, job: snapshot(job) } });
  };
  const settle = (job: Job, status: RecordData['status'], reason?: string): void => {
    job.record.status = status;
    job.record.statusMessage = reason ?? (status === 'cancelled' && job.queued ? 'cancelled before start' : status);
    job.record.lastUpdatedAt = clock.now().toISOString();
    job.terminalAt = clock.monotonicMs();
    job.finish();
  };
  const beginApply = (token: string, signal?: AbortSignal) => deps.beginHealApply?.(token, signal) ?? Promise.resolve({ proceed: true as const });
  const finishApply = (token: string, confirm: HealConfirm, signal?: AbortSignal) =>
    deps.settleHealApply?.(token, confirm, signal) ?? deps.applyHeal!(token, confirm, signal);
  const renderApply = (job: Job, outcome: ToolOutcome): void => {
    if (outcome.kind === 'error') {
      job.rendered = { isError: true, content: [{ type: 'text', text: `${outcome.code}: ${outcome.message}` }], structuredContent: undefined, _meta: {} };
    } else {
      job.result = { exitCode: outcome.exitCode, envelope: outcome.envelope };
      job.rendered = renderToolResult('heal', job.result);
    }
  };
  const wait = async (job: Job, ms: number, signal?: AbortSignal): Promise<'done' | 'timeout' | 'aborted'> => {
    if (job.record.status !== 'working') return 'done';
    if (signal?.aborted) return 'aborted';
    if (ms === 0) return 'timeout';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const deadline = clock.monotonicMs() + ms;
    try {
      return await Promise.race([
        job.done.then(() => 'done' as const),
        new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - clock.monotonicMs())); }),
        ...(signal ? [new Promise<'aborted'>((resolve) => { onAbort = () => resolve('aborted'); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) resolve('aborted'); })] : []),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    }
  };
  const cancel = async (job: Job): Promise<Response> => {
    if (job.record.status !== 'working') return response(renderJobRecord(snapshot(job)));
    if (job.queued) {
      if (job.applyToken !== undefined) {
        job.cancelling ??= (async () => {
          try {
            const consumed = await beginApply(job.applyToken!);
            if (consumed.proceed) await finishApply(job.applyToken!, 'interrupted', job.controller.signal);
            settle(job, 'cancelled', options?.signal?.aborted ? 'server shutting down' : undefined);
          } catch (error) {
            job.error = error;
            settle(job, 'failed');
          }
        })();
        await job.cancelling;
        return response(renderJobRecord(snapshot(job)));
      }
      settle(job, 'cancelled', options?.signal?.aborted ? 'server shutting down' : undefined);
      return response(renderJobRecord(snapshot(job)));
    }
    job.controller.abort();
    const finished = await wait(job, 10_000);
    if (finished === 'timeout' && job.record.status === 'working') {
      job.record.statusMessage = 'cancel requested';
      job.record.lastUpdatedAt = clock.now().toISOString();
    }
    return response(renderJobRecord(snapshot(job)));
  };

  const start = (tool: Tool, capability: Capability, args: Record<string, unknown>, extra: Extra): Job => {
    const now = clock.now().toISOString();
    const jobId = randomUUID();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const job: Job = {
      record: { jobId, tool, status: 'working', statusMessage: 'running', progress: 0,
        createdAt: now, lastUpdatedAt: now, pollIntervalMs: 2000, ttlMs: 1_800_000 },
      controller: new AbortController(), queued: true, done, finish,
      ...(capability === 'applyHeal' ? { applyToken: String(args.applyToken) } : {}),
    };
    jobs.set(jobId, job);
    queue = queue.then(async () => {
      if (job.cancelling !== undefined) await job.cancelling;
      if (job.record.status !== 'working' && capability !== 'applyHeal') return;
      if (job.record.status !== 'working') return;
      job.queued = false;
      if (capability === 'applyHeal') {
        try {
          const token = job.applyToken!;
          const consumed = await beginApply(token, job.controller.signal);
          if (!consumed.proceed) {
            renderApply(job, consumed.outcome);
            settle(job, 'completed');
            return;
          }
          if (options?.signal?.aborted || extra.signal?.aborted || job.controller.signal.aborted) {
            await finishApply(token, 'interrupted', job.controller.signal);
            settle(job, 'cancelled', options?.signal?.aborted ? 'server shutting down' : undefined);
            return;
          }
          const confirm = await confirmHeal(job.controller.signal);
          const outcome = await finishApply(token, job.controller.signal.aborted ? 'interrupted' : confirm, job.controller.signal);
          renderApply(job, outcome);
          settle(job, 'completed');
        } catch (error) {
          job.error = error;
          settle(job, 'failed');
        }
        return;
      }
      if (options?.signal?.aborted || (extra.signal?.aborted && !job.handleReturned) || job.record.status !== 'working') {
        settle(job, 'cancelled', options?.signal?.aborted ? 'server shutting down' : undefined);
        return;
      }
      const realProgressToken = extra._meta?.progressToken;
      // The internal token creates the runtime event sink without a client token.
      // Only a real token permits forwarding, and the original request stops receiving notifications after its handle.
      const progressToken = realProgressToken ?? jobId;
      try {
        job.result = await deps[capability](args, {
          progressToken,
          sendNotification: async (notification) => {
            if (notification.method === 'internal/run-event') {
              job.record.progress += 1;
              job.record.lastUpdatedAt = clock.now().toISOString();
            } else if (notification.method === 'notifications/progress') {
              if (job.record.status === 'working') {
                if (typeof notification.params?.message === 'string') job.record.statusMessage = notification.params.message;
                job.record.lastUpdatedAt = clock.now().toISOString();
              }
              if (realProgressToken !== undefined && !job.handleReturned) {
                await extra.sendNotification({ ...notification, params: { ...notification.params, progressToken: realProgressToken } } as ProgressNotification);
              }
            }
          },
        }, job.controller.signal);
        const envelope = job.result.envelope;
        const errors = typeof envelope === 'object' && envelope !== null && 'errors' in envelope ? envelope.errors : undefined;
        const interrupted = Array.isArray(errors) && errors.some((error: unknown) => typeof error === 'object' && error !== null && 'scope' in error && 'code' in error && error.scope === 'run' && error.code === 'INTERRUPTED');
        // Cache rendering under this catch boundary; terminal() marks token delivery only when returning it.
        job.rendered = renderToolResult(job.record.tool, job.result, job.result.applyToken);
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
    const outcome = await wait(job, options?.syncWaitMs ?? 45_000, extra.signal);
    if (outcome === 'aborted') {
      await cancel(job);
      return response(renderJobRecord(snapshot(job)));
    }
    if (outcome === 'done') {
      if (job.record.status === 'cancelled' && job.result === undefined) {
        return { isError: true, content: [{ type: 'text', text: 'Aborted' }], structuredContent: undefined, _meta: {} };
      }
      return terminal(job);
    }
    job.handleReturned = true;
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
  }, (args, extra) => args.dryRun === false ? applyHeal(String(args.applyToken), extra) : write('heal', 'healPreview')(args, extra));
  mcpServer.registerTool('ambercast_job_status', {
    description: 'Ambercast job status: inspect a write job. Optional input jobId selects one job; waitMs waits for completion.',
    inputSchema: statusInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ jobId, waitMs }, extra) => {
    prune();
    if (jobId === undefined) {
      const records = [...jobs.values()].map(snapshot).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.jobId.localeCompare(b.jobId));
      return { isError: false, content: [{ type: 'text' as const, text: records.map((record) => `${record.jobId} ${record.status} ${record.tool} ${record.createdAt}`).join('\n') || 'no jobs' }], structuredContent: { jobs: records }, _meta: {} };
    }
    const job = jobs.get(jobId);
    if (job === undefined) return missing(jobId);
    if (await wait(job, waitMs ?? 0, extra.signal) === 'aborted') return response(renderJobRecord(snapshot(job)));
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
      if (job.queued) void cancel(job);
      else job.controller.abort();
    }
  }, { once: true });

  return { connect: (transport: unknown) => mcpServer.connect(transport as Transport), close: () => mcpServer.close() };
}
