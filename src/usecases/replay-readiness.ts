/**
 * Shared artifact-based replay assessment for run and check.
 *
 * @remarks
 * One pure judgement keeps both commands' conclusions identical. It belongs
 * in usecases because grounding inspection lives here and neither command
 * should import the other. Readiness describes stored entry coverage, not
 * whether the current screen still matches those entries.
 */

import { computeIntentDigest } from '#core/ir/digest.js';
import { GroundingDocument, type PlanDocument, type Step } from '#core/ir/schema.js';
import type { ReadStorageAdapter } from '#ports/storage.js';
import { inspectGroundingArtifactText } from './check-grounding.js';
import { isLegacyShapedTrace } from './instruction-coverage-policy.js';

/**
 * Explains why a step lacks usable stored grounding.
 *
 * `no-entry` means no entry was stored; `entry-mismatch` means its kind or
 * element intent digest disagrees with the step; `trace-uncovered` means an
 * ai entry has a legacy trace without instruction coverage.
 */
export type ReplayStepReason = 'no-entry' | 'entry-mismatch' | 'trace-uncovered';

/**
 * Describes whether the artifact contains every entry required for replay.
 *
 * @remarks
 * Missing, unreadable, invalid, and stale grounding describe the whole
 * artifact. Only valid grounding can yield `steps-unresolved`, whose nonempty
 * list retains every affected step in plan order without a count limit.
 * A ready result promises entry coverage rather than live screen validity.
 */
export type ReplayReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'not-ready'; readonly reason: 'grounding-missing' | 'grounding-invalid' | 'grounding-stale' | 'grounding-unreadable' }
  | { readonly status: 'not-ready'; readonly reason: 'steps-unresolved'; readonly steps: readonly [{ id: string; reason: ReplayStepReason }, ...{ id: string; reason: ReplayStepReason }[]] };

/**
 * Adds a run's write-back restriction to an artifact assessment.
 *
 * @remarks
 * Only a not-ready run with changes to save and write-back disallowed may
 * carry `unsavedReason`. Secret-scan failures and write failures do not add
 * it: the case error already explains those failures. Persistence and this
 * annotation share the same write-back permission decision.
 */
export type RunReplayReadiness = ReplayReadiness
  | (Extract<ReplayReadiness, { status: 'not-ready' }> & { readonly unsavedReason: 'write-back-not-allowed' });

/**
 * Supplies an observed grounding artifact without giving the pure assessment I/O authority.
 *
 * Absence and inability to read remain distinct so diagnostics can explain
 * whether an artifact was found before its contents became unavailable.
 */
export type GroundingSource =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'text'; readonly text: string };

/**
 * Selects steps that require stored entries for replay, preserving plan order.
 *
 * @param plan - Plan whose click, press, fill, fill-secret, capture, and ai
 * steps require entries. Navigate and assert steps require none.
 * @returns The steps whose entry coverage must be assessed.
 */
export function replayEntrySteps(plan: PlanDocument): readonly Step[] {
  return plan.steps.filter(step => step.kind === 'ai' || step.kind === 'capture'
    || (step.kind === 'action' && step.action !== 'navigate'));
}

/**
 * Assesses stored entry coverage independently of a case's execution outcome.
 *
 * @param plan - Trusted plan against which grounding is assessed.
 * @param source - Grounding contents or the reason contents are unavailable.
 * @returns A shared readiness judgement for run and check.
 *
 * @remarks
 * Artifact validity precedes entry coverage so unusable contents never imply
 * usable replay entries. Element intent identity matches run's promotion,
 * and AI coverage uses the same legacy-trace boundary as replay. The
 * assessment never repairs or writes an artifact.
 */
export function assessReplayReadiness(plan: PlanDocument, source: GroundingSource): ReplayReadiness {
  const requiredSteps = replayEntrySteps(plan);
  if (requiredSteps.length === 0) return { status: 'ready' };
  if (source.kind === 'absent') return { status: 'not-ready', reason: 'grounding-missing' };
  if (source.kind === 'unreadable') return { status: 'not-ready', reason: 'grounding-unreadable' };

  const inspection = inspectGroundingArtifactText(source.text, plan);
  if (inspection.kind === 'invalid') return { status: 'not-ready', reason: 'grounding-invalid' };
  if (inspection.kind === 'stale') return { status: 'not-ready', reason: 'grounding-stale' };
  if (inspection.kind === 'missing') return { status: 'not-ready', reason: 'grounding-missing' };

  let grounding: GroundingDocument;
  try {
    const parsed = GroundingDocument.safeParse(JSON.parse(source.text));
    if (!parsed.success) return { status: 'not-ready', reason: 'grounding-invalid' };
    grounding = parsed.data;
  } catch {
    return { status: 'not-ready', reason: 'grounding-invalid' };
  }

  const unresolved: { id: string; reason: ReplayStepReason }[] = [];
  for (const step of requiredSteps) {
    const entry = grounding.entries[step.id];
    if (entry === undefined) {
      unresolved.push({ id: step.id, reason: 'no-entry' });
    } else if (step.kind === 'ai') {
      if (entry.kind !== 'ai') unresolved.push({ id: step.id, reason: 'entry-mismatch' });
      else if (isLegacyShapedTrace(entry.trace)) unresolved.push({ id: step.id, reason: 'trace-uncovered' });
    } else if (step.kind === 'capture' || (step.kind === 'action' && step.action !== 'navigate')) {
      const operation = step.kind === 'capture' ? 'capture' : step.action;
      if (entry.kind !== 'element'
        || entry.intentDigest !== computeIntentDigest({ stepKind: step.kind, operation, intent: step.intent })) {
        unresolved.push({ id: step.id, reason: 'entry-mismatch' });
      }
    }
  }
  const [first, ...rest] = unresolved;
  return first === undefined ? { status: 'ready' }
    : { status: 'not-ready', reason: 'steps-unresolved', steps: [first, ...rest] };
}

/**
 * Reads artifact readiness without replacing a case's status or error.
 *
 * @param storage - The same storage used for write-back, including heal's overlay.
 * @param groundingPath - Opaque companion path, when one is known.
 * @param plan - Trusted plan whose stored entry coverage is assessed.
 * @returns Readiness after the caller has completed write-back.
 *
 * @remarks
 * This diagnostic does not throw, so a read-back failure cannot mask the
 * execution outcome. Absence and read failure remain distinct, and plans
 * without required entries need no storage access.
 */
export async function readReplayReadiness(
  storage: ReadStorageAdapter,
  groundingPath: string | undefined,
  plan: PlanDocument,
): Promise<ReplayReadiness> {
  if (replayEntrySteps(plan).length === 0) return { status: 'ready' };
  if (groundingPath === undefined) return { status: 'not-ready', reason: 'grounding-missing' };
  try {
    if (!(await storage.exists(groundingPath))) return { status: 'not-ready', reason: 'grounding-missing' };
  } catch {
    return { status: 'not-ready', reason: 'grounding-missing' };
  }
  let text: string;
  try {
    text = await storage.readText(groundingPath);
  } catch {
    return { status: 'not-ready', reason: 'grounding-unreadable' };
  }
  return assessReplayReadiness(plan, { kind: 'text', text });
}
