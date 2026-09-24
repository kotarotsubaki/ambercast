import type { StorageAdapter } from '#ports/storage.js';
import {
  classifyAgents,
  classifyConfig,
  classifyGitignore,
  classifySample,
  decodePreservingBom,
  type ActionClassification,
  type InitRejectionReason,
} from '#core/init/plan.js';

/**
 * Holds the already-resolved absolute destinations of the four scaffold
 * artifacts.
 *
 * Runtime owns path resolution and supplies these opaque storage targets so
 * the usecase neither adopts platform path policy nor reconstructs paths that
 * a caller has already resolved.
 */
export interface InitArtifactTargets {
  readonly config: string;
  readonly sample: string;
  readonly gitignore: string;
  readonly agents: string;
}

/** Describes one planned artifact and its pure classification result. */
export interface InitPlanEntry {
  readonly path: string;
  readonly classification: ActionClassification;
}

/** Groups all four artifact plans in their required processing order. */
export interface InitPlan {
  readonly config: InitPlanEntry;
  readonly sample: InitPlanEntry;
  readonly gitignore: InitPlanEntry;
  readonly agents: InitPlanEntry;
}

/** Supplies the storage port and the configuration replacement policy. */
export interface InitUsecaseDeps {
  readonly storage: StorageAdapter;
  readonly force: boolean;
}

/**
 * Represents the value-based outcome of reading and classifying the scaffold.
 *
 * This discriminated union lets runtime branch on expected planning outcomes
 * without turning precondition, I/O, and interruption paths into catch-based
 * control flow.
 */
export type PlanInitResult =
  | { readonly kind: 'plan'; readonly plan: InitPlan }
  | { readonly kind: 'rejected'; readonly path: string; readonly reason: InitRejectionReason }
  | { readonly kind: 'read-failed'; readonly path: string; readonly error: unknown }
  | { readonly kind: 'interrupted' };

/**
 * Builds a sequential, pre-write plan for the four resolved artifact targets.
 *
 * @param deps - Storage and replacement policy used for classification.
 * @param targets - Absolute, runtime-resolved storage targets.
 * @param signal - Optional cancellation observed between individual reads.
 * @returns A plan or an explicit rejection, read failure, or interruption.
 * @remarks
 * Cancellation is observed between sequential reads because an interruption
 * may mean that no artifact has been inspected or that only a prefix has.
 * That timing is part of the pre-apply contract, rather than an incidental
 * implementation detail.
 */
export async function planInit(
  deps: InitUsecaseDeps,
  targets: InitArtifactTargets,
  signal?: AbortSignal,
): Promise<PlanInitResult> {
  const entries = [
    { key: 'config', path: targets.config, classify: (current: string | null) => classifyConfig(current, deps.force) },
    { key: 'sample', path: targets.sample, classify: classifySample },
    { key: 'gitignore', path: targets.gitignore, classify: classifyGitignore },
    { key: 'agents', path: targets.agents, classify: classifyAgents },
  ] as const;
  const plan: { -readonly [Key in keyof InitPlan]?: InitPlan[Key] } = {};

  for (const entry of entries) {
    if (signal?.aborted) {
      return { kind: 'interrupted' };
    }

    let current: string | null;
    try {
      const snapshot = await deps.storage.readTextSnapshotIfExists(entry.path);
      current = snapshot ? decodePreservingBom(snapshot.bytes) : null;
    } catch (error) {
      return { kind: 'read-failed', path: entry.path, error };
    }
    if (signal?.aborted) {
      return { kind: 'interrupted' };
    }

    const classification = entry.classify(current);
    if (classification.kind === 'rejected') {
      return { kind: 'rejected', path: entry.path, reason: classification.reason };
    }
    plan[entry.key] = { path: entry.path, classification };
  }

  return { kind: 'plan', plan: plan as InitPlan };
}

/** Enumerates the observable outcome of one planned artifact during apply. */
export type InitFileApplyState = 'written' | 'skipped' | 'failed' | 'not-attempted';

/** Records the target and observable state of one apply attempt. */
export interface InitFileApplyResult {
  readonly path: string;
  readonly state: InitFileApplyState;
}

/** Fixes apply reporting to the four artifacts, in processing order. */
export type InitFileApplyResults = readonly [
  InitFileApplyResult,
  InitFileApplyResult,
  InitFileApplyResult,
  InitFileApplyResult,
];

/**
 * Represents completion or an intentionally stopped sequential apply.
 *
 * Runtime can branch on this tagged result instead of recovering expected
 * interruption, concurrent-change, and write failures through exceptions.
 */
export type ApplyInitPlanResult =
  | { readonly kind: 'applied'; readonly results: InitFileApplyResults }
  | { readonly kind: 'interrupted'; readonly results: InitFileApplyResults }
  | {
      readonly kind: 'failed';
      readonly results: InitFileApplyResults;
      readonly path: string;
      readonly failure: 'mismatch' | 'write-failed';
      readonly error?: unknown;
    };

/**
 * Applies a previously accepted plan in artifact order.
 *
 * @param deps - Storage and replacement policy used to reclassify each write.
 * @param plan - The accepted plan whose targets and classifications are used.
 * @param signal - Optional cancellation observed before each write.
 * @returns Four ordered results and an applied, interrupted, or failed tag;
 * failures also identify the target, failure class, and original error.
 * @remarks
 * Observing cancellation between writes preserves whether interruption
 * occurred before any persistence or after a partial prefix. Commit-time
 * reclassification runs for every planned artifact, including skipped entries.
 * Its separate disposition distinguishes storage's `null` updater result for a
 * valid skip from a concurrent change that must stop the remaining writes.
 */
export async function applyInitPlan(
  deps: InitUsecaseDeps,
  plan: InitPlan,
  signal?: AbortSignal,
): Promise<ApplyInitPlanResult> {
  const entries = [
    { entry: plan.config, classify: (current: string | null) => classifyConfig(current, deps.force) },
    { entry: plan.sample, classify: classifySample },
    { entry: plan.gitignore, classify: classifyGitignore },
    { entry: plan.agents, classify: classifyAgents },
  ] as const;
  const results: [
    InitFileApplyResult,
    InitFileApplyResult,
    InitFileApplyResult,
    InitFileApplyResult,
  ] = [
    { path: entries[0].entry.path, state: 'not-attempted' },
    { path: entries[1].entry.path, state: 'not-attempted' },
    { path: entries[2].entry.path, state: 'not-attempted' },
    { path: entries[3].entry.path, state: 'not-attempted' },
  ];
  const complete = (): InitFileApplyResults => results;

  for (let index = 0; index < entries.length; index += 1) {
    const { entry, classify } = entries[index]!;
    if (signal?.aborted) {
      return { kind: 'interrupted', results: complete() };
    }

    let disposition: 'matched-skip' | 'matched-write' | 'mismatch' = 'mismatch';
    try {
      await deps.storage.updateTextExclusive(entry.path, (current) => {
        const currentClassification = classify(current);
        if (
          currentClassification.kind !== 'action'
          || !sameClassification(currentClassification, entry.classification)
        ) {
          return null;
        }
        disposition = currentClassification.action === 'skipped' ? 'matched-skip' : 'matched-write';
        return currentClassification.nextText;
      }, signal);
    } catch (error) {
      results[index] = { path: entry.path, state: 'failed' };
      return {
        kind: 'failed',
        results: complete(),
        path: entry.path,
        failure: 'write-failed',
        error,
      };
    }
    if (disposition === 'mismatch') {
      results[index] = { path: entry.path, state: 'failed' };
      return {
        kind: 'failed',
        results: complete(),
        path: entry.path,
        failure: 'mismatch',
      };
    }
    results[index] = { path: entry.path, state: disposition === 'matched-skip' ? 'skipped' : 'written' };
  }

  return { kind: 'applied', results: complete() };
}

function sameClassification(
  current: ActionClassification,
  planned: ActionClassification,
): boolean {
  return current.action === planned.action && current.nextText === planned.nextText;
}
