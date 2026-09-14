import type {
  ElementRef,
  InstructionAttributedSteps,
  SecretName,
  SecretRef,
  Step,
  StepId,
} from '#core/ir/schema.js';
import { PlanDocument } from '#core/ir/schema.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { secretNameFor } from '#core/ir/secret-ref.js';

/**
 * Records one pre-normalization secret use and the deterministic name chosen
 * for it.
 *
 * `useIndex` is intentionally absent for `fill-secret`: that action has one
 * use by construction. AI steps retain the original array index because
 * duplicate references must be named and diagnosed before the later
 * deduplicate-and-sort normalization can erase their individual identity.
 * `target` similarly exists only where an accessibility target can influence
 * a fill-secret name or cross-target reuse warning. The six selection sources
 * distinguish a projected explicit name, target-derived name, provider hint,
 * stable ordinal, reconstructed committed plan, and interactive rename
 * without making a report consumer infer policy from a string.
 */
export interface SecretUse {
  readonly ref: SecretRef;
  readonly name: SecretName;
  readonly stepId: StepId;
  readonly useIndex?: number;
  readonly target?: ElementRef;
  readonly selectionSource: 'allowed-name' | 'target-slug' | 'hint' | 'ordinal' | 'existing-plan' | 'interactive-rename';
}

/**
 * Describes a non-fatal naming condition that must survive into generation
 * reporting. The union defines the complete warning vocabulary so consent and
 * repair behavior share one stable report shape:
 * cross-target reuse identifies all affected steps, target change retains the
 * before-and-after locators for one step, and truncation records counts rather
 * than exposing an omitted name list.
 */
export type SecretWarning =
  | { readonly kind: 'secret-name-reused-across-targets'; readonly name: SecretName; readonly stepIds: readonly StepId[] }
  | { readonly kind: 'secret-target-changed'; readonly name: SecretName; readonly stepId: StepId; readonly previousTarget: ElementRef; readonly target: ElementRef }
  | { readonly kind: 'allowed-names-truncated'; readonly kept: number; readonly dropped: number };

/**
 * A fixed secret use retained while Stage 2 names only its frontier replacement.
 *
 * Retained plan uses seed the ordinary name-owner and canonical-target maps as
 * reservations, rather than being merged into provider candidates or P. That
 * preserves their committed references exactly, including under wildcard
 * execution policy, while still making suffix and target ownership decisions
 * see collisions at every original plan index (SPEC-C3-2).
 */
export interface ExistingPlanSecretReservation {
  readonly stepIndex: number;
  readonly stepId: StepId;
  readonly useIndex?: number;
  readonly ref: SecretRef;
  readonly name: SecretName;
  readonly target?: ElementRef;
  readonly targetKey?: string;
  readonly selectionSource: 'existing-plan';
}

/**
 * Inputs for naming one attributed Stage 2 replacement against a committed plan.
 *
 * The full plan supplies immutable reservations, while only the replacement is
 * provider-authored naming input. Keeping P separate from `allowlist` ensures
 * an explicit replacement choice is checked against the bounded provider
 * projection without retroactively validating or renaming retained uses
 * (SPEC-C3-2).
 */
export interface Stage2ReplacementNamingInput {
  readonly plan: import('#core/ir/schema.js').PlanDocument;
  readonly replacementIndex: number;
  readonly attributedReplacement: InstructionAttributedSteps[number];
  readonly projected: readonly SecretName[];
  readonly allowlist: readonly SecretName[] | '*';
}

/**
 * The validated full candidate and replacement-scoped naming evidence.
 *
 * The candidate is parsed as a whole plan after only the replacement is
 * materialized, so downstream obligation, allowlist, and replay gates observe
 * the same artifact. `uses` and `warnings` remain replacement-scoped to avoid
 * treating unchanged committed uses as fresh provider decisions (SPEC-C3-2).
 */
export interface Stage2ReplacementNamingOutput {
  readonly candidate: import('#core/ir/schema.js').PlanDocument;
  readonly replacement: Step;
  readonly uses: readonly SecretUse[];
  readonly warnings: readonly SecretWarning[];
}

/**
 * Derives a Stage 2 replacement without renaming its retained plan context.
 *
 * The algorithm enumerates all non-replacement secret uses as fixed
 * reservations, seeds the existing owner maps, runs the C1 naming machinery
 * at the replacement's original index, normalizes only its AI references, and
 * then parses the spliced whole-plan candidate (SPEC-C3-2). Reusing retained
 * step objects is an invariant: no repair naming path may reconstruct or
 * alter a committed reference merely because it participates in collision
 * allocation.
 *
 * @param input - The committed plan, frontier replacement, and separated
 * provider projection and execution policy.
 * @returns The whole candidate plus replacement-only naming evidence.
 * @throws {AiResponseInvalidError} When an explicit replacement name is outside
 * the projection or fixed target ownership is inconsistent.
 */
export function deriveStage2ReplacementSecretNames(
  input: Stage2ReplacementNamingInput,
): Stage2ReplacementNamingOutput {
  const reservations: ExistingPlanSecretReservation[] = [];
  for (const [stepIndex, step] of input.plan.steps.entries()) {
    if (stepIndex === input.replacementIndex) continue;
    if (step.kind === 'action' && step.action === 'fill-secret') {
      reservations.push({ stepIndex, stepId: step.id, ref: step.secretRef, name: secretNameFor(step.secretRef), target: step.target, targetKey: canonicalTargetKey(step.target), selectionSource: 'existing-plan' });
    } else if (step.kind === 'ai') {
      for (const [useIndex, { ref }] of (step.secrets ?? []).entries()) {
        reservations.push({ stepIndex, stepId: step.id, useIndex, ref, name: secretNameFor(ref), selectionSource: 'existing-plan' });
      }
    }
  }
  const attributed = input.plan.steps.map((step, index) => index === input.replacementIndex ? input.attributedReplacement : step) as InstructionAttributedSteps;
  const named = deriveSecretNames(attributed, {
    projected: input.projected,
    allowlist: input.allowlist,
    reservations,
    candidateStepIndexes: new Set([input.replacementIndex]),
  });
  const replacement = normalizeAiStepSecretUses([named.steps[input.replacementIndex]!])[0]!;
  const parsedCandidate = PlanDocument.parse({
    ...input.plan,
    steps: [...input.plan.steps.slice(0, input.replacementIndex), replacement, ...input.plan.steps.slice(input.replacementIndex + 1)],
  });
  const candidate = {
    ...input.plan,
    steps: input.plan.steps.map((step, index) => index === input.replacementIndex ? parsedCandidate.steps[index]! : step),
  } as PlanDocument;
  return {
    candidate,
    replacement,
    uses: named.uses.filter(({ stepId }) => stepId === replacement.id),
    warnings: named.warnings.filter((warning) => warning.kind !== 'secret-name-reused-across-targets' || warning.stepIds.includes(replacement.id)),
  };
}

/**
 * Resolves provider naming choices into committed secret references while
 * retaining a reportable account of every use (SPEC-C1-3, C1-4).
 *
 * The algorithm names each fill-secret use by exact membership in
 * the projected set P, then a non-empty slug of its target name, then a name
 * hint, then its one-based step ordinal. AI uses omit target slug and use an
 * ordinal containing their one-based original array position. P is not the
 * allowlist A: P permits an explicit `allowedName`; A only permits promotion
 * of an already derived name. An all-allowing A authorizes execution but never
 * supplies a name for reuse. Empty slugs fall through rather than producing
 * an invalid empty name.
 *
 * Resolution then performs three ordered collision passes: allowed names may
 * share across targets (emitting one reuse warning when comparable canonical
 * targets differ), equal canonical fill targets may share, and all remaining
 * names receive the first available numeric suffix. A shared name inherits
 * the selection source from the earliest pre-normalization use that
 * established it. Before target sharing or suffix allocation, competing
 * reserved names for one canonical target cause a validation error that names
 * only the later participating steps. All
 * unprojected explicit-name errors are accumulated in step/use order before
 * those target conflicts. Warnings are ordered by their specified
 * UTF-16 sort keys: `reuse = [kind, name, stepIds[0] ?? ""]`,
 * `target = [kind, name, stepId]`, and `truncation = [kind, "", ""]`. Each
 * unprojected explicit name becomes an `AiResponseInvalidError` issue with
 * code `secret-allowed-name-not-projected`, path
 * `steps[n].secret.allowedName` or `steps[n].secrets[u].allowedName` (both
 * zero-based), and its required `stepId`; each target conflict uses
 * `secret-conflicting-target-names` at `steps[n].secret`, also with its
 * required `stepId`. The returned steps still require
 * {@link normalizeAiStepSecretUses}; keeping normalization separate preserves
 * the original AI use identity needed for errors and selection provenance.
 */
export function deriveSecretNames(
  attributed: InstructionAttributedSteps,
  sets: {
    readonly projected: readonly SecretName[];
    readonly allowlist: readonly SecretName[] | '*';
    readonly reservations?: readonly ExistingPlanSecretReservation[];
    readonly candidateStepIndexes?: ReadonlySet<number>;
  },
): { steps: Step[]; uses: SecretUse[]; warnings: SecretWarning[] } {
  type Candidate = {
    readonly step: Record<string, unknown>;
    readonly stepIndex: number;
    readonly stepId: StepId;
    readonly useIndex?: number;
    readonly target?: ElementRef;
    readonly targetKey?: string;
    readonly explicit: boolean;
    readonly candidate: SecretName;
    readonly selectionSource: SecretUse['selectionSource'];
    name?: SecretName;
    source?: SecretUse['selectionSource'];
  };
  const projected = new Set(sets.projected);
  const candidates: Candidate[] = [];
  const invalidIssues: { code: string; path: string; stepId: StepId }[] = [];
  for (const [stepIndex, step] of attributed.entries()) {
    if (sets.candidateStepIndexes !== undefined && !sets.candidateStepIndexes.has(stepIndex)) continue;
    const current = step as unknown as Record<string, unknown>;
    if (current.kind === 'action' && current.action === 'fill-secret') {
      const choice = current.secret as { allowedName?: SecretName; nameHint?: SecretName } | undefined;
      if (choice?.allowedName !== undefined && !projected.has(choice.allowedName)) {
        invalidIssues.push({ code: 'secret-allowed-name-not-projected', path: `steps[${stepIndex}].secret.allowedName`, stepId: step.id });
        continue;
      }
      const target = current.target as ElementRef;
      const targetSlug = slug(target.name);
      const name = (choice?.allowedName ?? targetSlug) || choice?.nameHint || `secret_step_${stepIndex + 1}`;
      candidates.push({ step: current, stepIndex, stepId: step.id, target, targetKey: canonicalTargetKey(target), explicit: choice?.allowedName !== undefined, candidate: name as SecretName, selectionSource: choice?.allowedName !== undefined ? 'allowed-name' : targetSlug ? 'target-slug' : choice?.nameHint !== undefined ? 'hint' : 'ordinal' });
    } else if (current.kind === 'ai') {
      for (const [useIndex, choice] of ((current.secrets as readonly { allowedName?: SecretName; nameHint?: SecretName }[] | undefined) ?? []).entries()) {
        if (choice.allowedName !== undefined && !projected.has(choice.allowedName)) {
          invalidIssues.push({ code: 'secret-allowed-name-not-projected', path: `steps[${stepIndex}].secrets[${useIndex}].allowedName`, stepId: step.id });
          continue;
        }
        const name = choice.allowedName ?? choice.nameHint ?? `secret_step_${stepIndex + 1}_${useIndex + 1}`;
        candidates.push({ step: current, stepIndex, stepId: step.id, useIndex, explicit: choice.allowedName !== undefined, candidate: name as SecretName, selectionSource: choice.allowedName !== undefined ? 'allowed-name' : choice.nameHint !== undefined ? 'hint' : 'ordinal' });
      }
    }
  }
  if (invalidIssues.length > 0) throw new AiResponseInvalidError('Generated secret names are not projected.', { issues: invalidIssues });

  const owners = new Map<SecretName, { readonly source: SecretUse['selectionSource'] }>();
  const targetNames = new Map<string, SecretName>();
  const targetIssues: { code: string; path: string; stepId: StepId }[] = [];
  for (const reservation of sets.reservations ?? []) {
    if (!owners.has(reservation.name)) owners.set(reservation.name, { source: reservation.selectionSource });
    if (reservation.targetKey === undefined) continue;
    const establishedForTarget = targetNames.get(reservation.targetKey);
    if (establishedForTarget !== undefined && establishedForTarget !== reservation.name) {
      targetIssues.push({ code: 'secret-conflicting-target-names', path: `steps[${reservation.stepIndex}].secret`, stepId: reservation.stepId });
      continue;
    }
    if (establishedForTarget === undefined) targetNames.set(reservation.targetKey, reservation.name);
  }
  if (targetIssues.length > 0) throw new AiResponseInvalidError('Generated secret names conflict for one target.', { issues: targetIssues });
  const isReserved = (candidate: Candidate): boolean => candidate.explicit || (sets.allowlist !== '*' && sets.allowlist.includes(candidate.candidate));

  // Pass 1: reserve every projected explicit or allowlist-promoted name before
  // source order can allocate a derived name that must instead be suffixed.
  for (const candidate of candidates.filter(isReserved)) {
    const owner = owners.get(candidate.candidate);
    candidate.name = candidate.candidate;
    candidate.source = owner?.source ?? candidate.selectionSource;
    if (owner === undefined) owners.set(candidate.candidate, { source: candidate.source ?? candidate.selectionSource });

    if (candidate.targetKey === undefined) continue;
    const establishedForTarget = targetNames.get(candidate.targetKey);
    if (establishedForTarget !== undefined && establishedForTarget !== candidate.candidate) {
      targetIssues.push({ code: 'secret-conflicting-target-names', path: `steps[${candidate.stepIndex}].secret`, stepId: candidate.stepId });
      continue;
    }
    if (establishedForTarget === undefined) targetNames.set(candidate.targetKey, candidate.candidate);
  }
  if (targetIssues.length > 0) throw new AiResponseInvalidError('Generated secret names conflict for one target.', { issues: targetIssues });

  // Passes 2 and 3: non-reserved fills share an established canonical target;
  // every other use receives an unused suffix of its original candidate.
  for (const candidate of candidates.filter((candidate) => !isReserved(candidate))) {
    const establishedForTarget = candidate.targetKey === undefined ? undefined : targetNames.get(candidate.targetKey);
    let name = establishedForTarget ?? candidate.candidate;
    if (establishedForTarget === undefined && owners.has(name)) {
      let suffix = 2;
      // Probe from the original base name so each collision consumes _2, _3, ….
      while (owners.has(`${candidate.candidate}_${suffix}` as SecretName)) suffix += 1;
      name = `${candidate.candidate}_${suffix}` as SecretName;
    }
    const owner = owners.get(name);
    candidate.name = name;
    candidate.source = owner?.source ?? candidate.selectionSource;
    if (owner === undefined) owners.set(name, { source: candidate.source ?? candidate.selectionSource });
    if (candidate.targetKey !== undefined && establishedForTarget === undefined) targetNames.set(candidate.targetKey, name);
  }

  const resolved = candidates.filter((candidate): candidate is Candidate & { name: SecretName; source: SecretUse['selectionSource'] } => candidate.name !== undefined && candidate.source !== undefined);
  const byStep = new Map<number, typeof resolved>();
  for (const candidate of resolved) byStep.set(candidate.stepIndex, [...(byStep.get(candidate.stepIndex) ?? []), candidate]);
  const steps = attributed.map((step, stepIndex) => {
    if (sets.candidateStepIndexes !== undefined && !sets.candidateStepIndexes.has(stepIndex)) return step;
    const stepCandidates = byStep.get(stepIndex) ?? [];
    const current = step as unknown as Record<string, unknown>;
    if (current.kind === 'action' && current.action === 'fill-secret') {
      const candidate = stepCandidates[0];
      if (candidate === undefined) throw new Error('Internal invariant: fill-secret step has no resolved secret name.');
      const { name } = candidate;
      const { secret: _secret, ...rest } = current;
      return { ...rest, secretRef: `{{secrets.${name}}}` };
    }
    if (current.kind === 'ai' && stepCandidates.length > 0) {
      const { secrets: _secrets, ...rest } = current;
      return { ...rest, secrets: stepCandidates.map(({ name }) => ({ ref: `{{secrets.${name}}}` })) };
    }
    return step;
  }) as Step[];
  const uses = resolved.map(({ name, source, stepId, useIndex, target }) => ({ ref: `{{secrets.${name}}}` as SecretRef, name, stepId, ...(useIndex === undefined ? {} : { useIndex }), ...(target === undefined ? {} : { target }), selectionSource: source }));
  const warnings: SecretWarning[] = [];
  for (const [name, matching] of groupBy(resolved.filter(({ target }) => target !== undefined), ({ name: candidateName }) => candidateName)) {
    const targets = new Set(matching.map(({ targetKey }) => targetKey));
    if (targets.size > 1) warnings.push({ kind: 'secret-name-reused-across-targets', name, stepIds: [...new Set(matching.map(({ stepId }) => stepId))] });
  }
  return { steps, uses, warnings: warnings.sort(compareSecretWarnings) };
}

/**
 * Produces the committed AI-secret representation after name resolution.
 *
 * The transform deduplicates each AI step's resolved references and
 * puts them in deterministic order, while leaving every other step unchanged.
 * It deliberately runs after {@link deriveSecretNames}: report joins use the
 * stable `(stepId, ref)` pair because an original `useIndex` is no longer
 * meaningful after deduplication and sorting.
 */
export function normalizeAiStepSecretUses(steps: readonly Step[]): Step[] {
  return steps.map((step) => {
    if (step.kind !== 'ai' || step.secrets === undefined) return step;
    const secrets = [...new Map(step.secrets.map((use) => [use.ref, use])).values()].sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
    if (secrets.length > 0) return { ...step, secrets };
    const { secrets: _secrets, ...withoutSecrets } = step;
    return withoutSecrets;
  }) as Step[];
}

/**
 * Derives the target-name candidate used by the fill-secret naming ladder.
 *
 * The transform applies NFKC normalization, lowercases, collapses
 * non-ASCII-alphanumeric runs to separators, removes edge separators,
 * prefixes a leading digit, and truncates the result to 64 characters. This
 * deliberately favors stable ASCII identifiers over locale- or
 * provider-dependent transliteration; an empty result is a signal to try the
 * next naming rung, never a valid candidate.
 */
export function slug(input: string): string {
  const value = input.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${/^\d/.test(value) ? 's_' : ''}${value}`.slice(0, 64);
}

function groupBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
}

export function compareSecretWarnings(left: SecretWarning, right: SecretWarning): number {
  const key = (warning: SecretWarning): readonly string[] => warning.kind === 'secret-name-reused-across-targets'
    ? [warning.kind, warning.name, warning.stepIds[0] ?? '']
    : warning.kind === 'secret-target-changed'
      ? [warning.kind, warning.name, warning.stepId]
      : [warning.kind, '', ''];
  const leftKey = key(left);
  const rightKey = key(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const leftValue = leftKey[index];
    const rightValue = rightKey[index];
    if (leftValue === undefined || rightValue === undefined) throw new Error('Internal invariant: warning sort keys have equal lengths.');
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function canonicalTargetKey(target: ElementRef): string {
  return JSON.stringify([target.strategy, target.role, target.name]);
}
