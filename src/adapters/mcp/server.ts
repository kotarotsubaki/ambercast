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
type Capability = 'generate' | 'run' | 'healPreview';
type Result = { exitCode: number; envelope: unknown; applyToken?: string };
type JobClock = { now(): Date; monotonicMs(): number };
type Response = { isError: boolean; content: { type: 'text'; text: string }[]; structuredContent: { [key: string]: unknown } | undefined; _meta?: Record<string, unknown> };
type Extra = { signal?: AbortSignal; _meta?: { progressToken?: string | number | undefined }; sendNotification: (notification: ProgressNotification) => Promise<void> };
type RecordData = {
  jobId: string; tool: Tool; status: 'working' | 'completed' | 'failed' | 'cancelled';
  statusMessage: string; progress: number; createdAt: string; lastUpdatedAt: string;
  pollIntervalMs: number; ttlMs: number;
};
type Job = {
  record: RecordData; controller: AbortController; queued: boolean;
  result?: Result; error?: unknown; terminalAt?: number; handleReturned?: boolean;
  rendered?: ReturnType<typeof renderToolResult>;
  delivered?: boolean;
  done: Promise<void>; finish: () => void;
};

/**
 * Apply consumes a token before confirmation and admits only authorized
 * settlement to the shared write FIFO. Declined and interrupted settlement
 * bypass that queue. The adapter owns SDK confirmation and queue order while
 * runtime owns token state and the resulting report.
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
  const confirmHeal = async (cases: readonly { readonly file: string; readonly healingSummary: string }[], signal?: AbortSignal): Promise<HealConfirm> => {
    const elicitationForm = mcpServer.server.getClientCapabilities()?.elicitation?.form;
    if (elicitationForm === undefined) {
      return 'authorized';
    }
    try {
      const result = await mcpServer.server.elicitInput({
        mode: 'form',
        message: `Apply ${cases.length} repair(s) to plan/grounding files?\n${cases.map(({ file, healingSummary }) => `${file}: ${healingSummary}`).join('\n')}`,
        requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean', title: 'Apply repairs' } }, required: ['confirm'] },
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
  type WriteTask = { run: () => Promise<void> };
  const pendingWrites: WriteTask[] = [];
  let writeRunning = false;
  const drainWrites = async (): Promise<void> => {
    if (writeRunning) return;
    writeRunning = true;
    try {
      while (pendingWrites.length > 0) await pendingWrites.shift()!.run();
    } finally {
      writeRunning = false;
    }
  };
  const enqueueWrite = (run: () => Promise<void>): (() => boolean) => {
    const task = { run };
    pendingWrites.push(task);
    void drainWrites();
    return () => {
      const index = pendingWrites.indexOf(task);
      if (index < 0) return false;
      pendingWrites.splice(index, 1);
      return true;
    };
  };

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
  const missing = (id: string): Response => ({ isError: true, content: [{ type: 'text', text: `JOB_NOT_FOUND: ${id}` }], structuredContent: undefined });
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
  const beginApply = (token: string, signal?: AbortSignal) => deps.beginHealApply?.(token, signal)
    ?? Promise.resolve({ proceed: true as const, cases: [] });
  const finishApply = (token: string, confirm: HealConfirm, signal?: AbortSignal, progress?: Parameters<NonNullable<McpServerDeps['settleHealApply']>>[3]) =>
    deps.settleHealApply?.(token, confirm, signal, progress) ?? deps.applyHeal!(token, confirm, signal);
  const renderApply = (outcome: ToolOutcome): Response => outcome.kind === 'error'
    ? { isError: true, content: [{ type: 'text', text: `${outcome.code}: ${outcome.message}` }], structuredContent: undefined }
    : response(renderToolResult('heal', { exitCode: outcome.exitCode, envelope: outcome.envelope }));
  const renderSettledApply = async (token: string, outcome: ToolOutcome): Promise<Response> => {
    const rendered = renderApply(outcome);
    await deps.finalizeHealApply?.(token);
    return rendered;
  };
  /** Runs apply synchronously while reserving the write FIFO only for authorized settlement. */
  const runApply = async (token: string, extra: Extra): Promise<Response> => {
    const signal = AbortSignal.any([extra.signal, options.signal].filter((candidate): candidate is AbortSignal => candidate !== undefined));
    const progress = {
      progressToken: extra._meta?.progressToken,
      sendNotification: async (notification: { readonly method: string; readonly params?: Record<string, unknown> }) => {
        if (extra._meta?.progressToken !== undefined && notification.method === 'notifications/progress') {
          await extra.sendNotification(notification as ProgressNotification);
        }
      },
    };
    const consumed = await beginApply(token, signal);
    if (!consumed.proceed) return renderApply(consumed.outcome);
    let decision: HealConfirm = signal.aborted ? 'interrupted' : await confirmHeal(consumed.cases, signal);
    if (signal.aborted) decision = 'interrupted';
    deps.stderr.write(`ambercast mcp: heal apply ${decision}\n`);
    if (decision !== 'authorized') return renderSettledApply(token, await finishApply(token, decision, signal, progress));
    return new Promise<Response>((resolve, reject) => {
      let started = false;
      let completed = false;
      let remove = (): boolean => false;
      const settle = async (choice: HealConfirm): Promise<void> => {
        try {
          const outcome = await finishApply(token, choice, signal, progress);
          resolve(await renderSettledApply(token, outcome));
        } catch (error) { reject(error); }
        finally { completed = true; signal.removeEventListener('abort', onAbort); }
      };
      const onAbort = (): void => {
        if (started || completed) return;
        if (remove()) void settle('interrupted');
      };
      signal.addEventListener('abort', onAbort, { once: true });
      remove = enqueueWrite(async () => {
        started = true;
        if (signal.aborted) { await settle('interrupted'); return; }
        await settle('authorized');
      });
      if (signal.aborted) onAbort();
    });
  };
  const applyHeal = async (token: string, extra: Extra): Promise<Response> => {
    try {
      return await runApply(token, extra);
    } catch (error) {
      if (deps.failHealApply !== undefined) return renderApply(await deps.failHealApply(token, error));
      const name = error instanceof Error ? error.name : 'Error';
      return renderApply({ kind: 'error', code: 'HEAL_APPLY_FAILED', message: `the apply crashed unexpectedly (${name})` });
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
    };
    jobs.set(jobId, job);
    enqueueWrite(async () => {
      if (job.record.status !== 'working') return;
      job.queued = false;
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
      /**
       * A queued job that ended before execution still has a record for its
       * original synchronous caller. The record response preserves
       * its job identity and cancellation reason; settle() has already stored
       * that reason in statusMessage, so rendering need not infer it here.
       */
      if (job.record.status === 'cancelled' && job.result === undefined) {
        return response(renderJobRecord(snapshot(job)));
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
