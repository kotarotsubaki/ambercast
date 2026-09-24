import { createPlaywrightUiExecutor } from './chromium.js';
import { BrowserLaunchFailedError } from '#core/errors/browser-launch-failed-error.js';
import type { UiExecutor } from '#ports/browser.js';
import type { UiExecutorKind } from '#core/config/schema.js';
import type { ResolvedUiExecutorConfig } from '#core/config/schema.js';

/**
 * Construction-time choices shared by every executor selected from this
 * registry.
 *
 * These options are intentionally not part of `UiExecutorResolver`: the
 * port resolves only an already-composed executor, while CLI policy such as
 * `--headed` is known before any case selects one.
 */
type ExecutorLaunchOptions = {
  readonly headed?: boolean;
};

/**
 * Internal constructors for the executors this composition root can provide.
 *
 * The per-executor options parameter belongs only to adapter construction. It
 * is not exported in place of `UiExecutorResolver`, whose fixed
 * executor-only shape is the contract consumed by the rest of the application.
 */
const UI_EXECUTOR_FACTORIES: Partial<Record<
  UiExecutorKind,
  (executor: ResolvedUiExecutorConfig, options?: ExecutorLaunchOptions) => UiExecutor
>> = {
  playwright: createPlaywrightUiExecutor,
};

/**
 * Creates the fixed-shape resolver used by run composition.
 *
 * @param options - Executor choices captured once for this composed command,
 * including whether Playwright should be headed.
 * @returns An executor-only resolver compatible with `UiExecutorResolver`.
 * @throws `BrowserLaunchFailedError` when
 *   `UI_EXECUTOR_FACTORIES[kind]` has no registered entry.
 *
 * @remarks
 * The resolver closes over CLI-supplied options when composition is created,
 * then selects a factory only when a target supplies its executor. This
 * preserves the existing resolver port instead of leaking per-executor
 * construction options into every caller.
 *
 * The unregistered-executor branch ensures that a schema-valid target whose
 * executor has no registered factory fails with a classified error rather than
 * a bare `TypeError`, regardless of the registered executor set.
 */
export function createUiExecutorResolver(
  options?: ExecutorLaunchOptions,
): (executor: ResolvedUiExecutorConfig) => UiExecutor {
  return (executor) => {
    const factory = UI_EXECUTOR_FACTORIES[executor.kind];

    if (factory === undefined) {
      throw new BrowserLaunchFailedError(`No UI executor is registered for kind: ${executor.kind}`, {
        reason: 'executor-unregistered',
        engine: executor.kind,
      });
    }

    return factory(executor, options);
  };
}
