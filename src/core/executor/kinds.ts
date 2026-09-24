/**
 * Defines the single UI executor vocabulary shared by config validation,
 * the executor port, and adapter registration. Keeping these consumers tied
 * to one tuple prevents independently edited kind lists from disagreeing.
 */
export const UI_EXECUTOR_KINDS = ['playwright'] as const;

export type UiExecutorKind = (typeof UI_EXECUTOR_KINDS)[number];
