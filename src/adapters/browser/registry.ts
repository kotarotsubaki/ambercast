/**
 * Composes factories for the validated UI executor vocabulary. A total record
 * makes an unregistered kind unreachable, so no defensive launch error remains.
 */

import { createPlaywrightUiExecutor } from './chromium.js';
import type { UiExecutor } from '#ports/browser.js';
import type { UiExecutorKind } from '#core/executor/kinds.js';
import type { ResolvedUiExecutorConfig } from '#core/config/schema.js';

/**
 * Constructs a UI executor from resolved config and composition choices.
 * Required headed mode keeps this contract independent of adapter defaults.
 */
export type UiExecutorFactory = (
  executor: ResolvedUiExecutorConfig,
  options: { readonly headed: boolean },
) => UiExecutor;

/**
 * Covers every validated kind. `satisfies` detects missing registrations at
 * compile time when the shared vocabulary grows.
 */
const UI_EXECUTOR_FACTORIES = {
  playwright: createPlaywrightUiExecutor,
} satisfies Record<UiExecutorKind, UiExecutorFactory>;

/**
 * Creates the fixed-shape resolver used by run composition.
 *
 * @param options - Headed mode and optional per-kind factory seeds.
 * @returns An executor-only resolver compatible with `UiExecutorResolver`.
 *
 * @remarks
 * Factory seeds are for test composition only: they let the shared replay
 * contract pass config through this registry under different observations.
 * Runtime composition omits them and uses the total defaults. Construction
 * options stay outside the executor-only resolver port because they are known
 * before any target is selected.
 */
export function createUiExecutorResolver(
  options?: { headed?: boolean; factories?: Partial<Record<UiExecutorKind, UiExecutorFactory>> },
): (executor: ResolvedUiExecutorConfig) => UiExecutor {
  return (executor) => (options?.factories?.[executor.kind] ?? UI_EXECUTOR_FACTORIES[executor.kind])(
    executor,
    { headed: options?.headed ?? false },
  );
}
