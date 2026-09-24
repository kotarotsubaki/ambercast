/*
 * Defines the capability vocabulary for UI executors.
 */

import { type PlanDocument, type GroundingDocument } from './schema.js';

/**
 * Names the operations and resolution features a UI executor can promise.
 *
 * @remarks
 * The vocabulary lets preflight compare a plan with an executor before any
 * session opens. `snapshot` covers AI element re-resolution through
 * `snapshotForResolution`; `agentic` covers autonomous execution through
 * `AiActionController`.
 */
export type UiCapability =
  | 'click'
  | 'navigate'
  | 'press'
  | 'fill'
  | 'fill-secret'
  | 'text-visible'
  | 'element-visible'
  | 'text-equals'
  | 'url-matches'
  | 'element-count'
  | 'capture'
  | 'snapshot'
  | 'agentic';

/**
 * The complete capability vocabulary in canonical order.
 *
 * @remarks
 * Preflight errors and derived sets use this order so their output is stable
 * regardless of step or grounding trace order. Callers must not mutate it.
 */
export const UI_CAPABILITIES: readonly UiCapability[] = [
  'click',
  'navigate',
  'press',
  'fill',
  'fill-secret',
  'text-visible',
  'element-visible',
  'text-equals',
  'url-matches',
  'element-count',
  'capture',
  'snapshot',
  'agentic',
];

/**
 * Derives each target's executor requirements from the plan and grounding.
 *
 * @param plan - The plan document to analyze.
 * @param grounding - The grounding document, or undefined if none exists.
 * @param options - Resolution policy for this run or heal operation.
 * @param options.resolve - Whether AI resolution is permitted.
 * @returns A record of target names to required capabilities in canonical order.
 *
 * @remarks
 * The algorithm is pure so run and heal share one requirement
 * calculation without I/O, AI calls, or grounding writes. It attributes each
 * action's `action`, assertion's `check`, and capture's `capture` capability to
 * that step's target. For an AI step with an AI grounding entry, it also reads
 * every `trace.events[].type` (using `check` for an `assert` event) and every
 * `trace.verification.check` into that AI step's target requirements.
 *
 * When `resolve` is true, a target with any element-bearing step (click,
 * press, fill, fill-secret, element-visible, text-equals, element-count, or
 * capture) additionally requires `snapshot`; any target with an AI step
 * requires `agentic`, even without a trace or an expected fallback. An AI step
 * without a trace requires nothing when `resolve` is false. The result
 * deduplicates each target's requirements and iterates `UI_CAPABILITIES`
 * to preserve canonical order; requirements never leak between targets.
 */
export function deriveRequiredCapabilities(
  plan: PlanDocument,
  grounding: GroundingDocument | undefined,
  options: { resolve: boolean }
): Record<string, ReadonlySet<UiCapability>> {
  const required = Object.fromEntries(
    Object.keys(plan.targets).map((target) => [target, new Set<UiCapability>()])
  );

  for (const step of plan.steps) {
    const capabilities = required[step.target]!;
    if (step.kind === 'action') {
      capabilities.add(step.action);
    } else if (step.kind === 'assert') {
      capabilities.add(step.check);
    } else if (step.kind === 'capture') {
      capabilities.add('capture');
    } else if (step.kind === 'ai') {
      const entry = grounding?.entries[step.id];
      if (entry?.kind === 'ai') {
        for (const event of entry.trace.events) {
          capabilities.add(event.type === 'assert' ? event.check : event.type);
        }
        for (const verification of entry.trace.verification) {
          capabilities.add(verification.check);
        }
      }
    }

    if (options.resolve) {
      if (
        (step.kind === 'action' &&
          (step.action === 'click' || step.action === 'press' || step.action === 'fill' || step.action === 'fill-secret')) ||
        (step.kind === 'assert' &&
          (step.check === 'element-visible' || step.check === 'text-equals' || step.check === 'element-count')) ||
        step.kind === 'capture'
      ) {
        capabilities.add('snapshot');
      }
      if (step.kind === 'ai') {
        capabilities.add('agentic');
      }
    }
  }

  return Object.fromEntries(
    Object.keys(plan.targets).map((target) => [
      target,
      new Set(UI_CAPABILITIES.filter((capability) => required[target]!.has(capability))),
    ])
  );
}
