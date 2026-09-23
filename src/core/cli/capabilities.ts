/**
 * Keeps the planned capability vocabulary in one place so generated capabilities and
 * documentation checks cannot silently disagree. The generated artifact must retain its
 * existing bytes; independent literal expectations in tests remain an oracle for this tuple.
 */
export const PLANNED_CAPABILITIES = ['view', 'review', 'mcp', 'baseline', 'restore'] as const;
