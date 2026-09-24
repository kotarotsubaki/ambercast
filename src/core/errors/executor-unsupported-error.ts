/*
 * Provides the error for when a configured executor does not support the
 * required capabilities or surface of a plan.
 */

import { AmbercastError } from './types.js';
import type { UiCapability } from '../ir/capabilities.js';

/**
 * Reports that a target's executor cannot support the plan before replay.
 *
 * @remarks
 * Preflight raises this usage error before opening a session, since changing
 * the configured executor can correct the mismatch. A surface mismatch takes
 * precedence over capability comparison and carries an empty `missing` list;
 * capability gaps use `UI_CAPABILITIES` order for stable diagnostics.
 */
export class ExecutorUnsupportedError extends AmbercastError {
  readonly kind = 'executor-unsupported' as const;

  constructor(
    message: string,
    readonly details: ExecutorUnsupportedDetails,
    options?: { cause?: unknown }
  ) {
    super(message, details, options);
  }
}

/**
 * The shape of details for {@link ExecutorUnsupportedError}.
 */
export type ExecutorUnsupportedDetails = {
  readonly target: string;
  readonly executor: string;
  readonly reason: 'surface-mismatch' | 'capability-missing';
  readonly missing: readonly UiCapability[];
  readonly surface?: { readonly target: string; readonly executor: string };
};
