/**
 * Creates command-scoped identifiers for provider dispatch lifecycle events.
 *
 * @returns A function that allocates the next identifier in its private
 * sequence.
 *
 * @remarks
 * The allocator keeps this state in a closure rather than a
 * process-wide counter so nested generate, run, and heal work can share the
 * allocator supplied by one runtime command without leaking ordering into a
 * later command.
 */
export function createCallIdAllocator(): () => string {
  let next = 1;
  return () => `ai-${next++}`;
}
