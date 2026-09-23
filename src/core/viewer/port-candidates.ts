/*
 * Keeps the view command's port selection deterministic and separate from the
 * HTTP adapter, which owns listen attempts and bind-error classification.
 */

/**
 * Selects the ordered ports on which the viewer may attempt to listen.
 *
 * @param input - The explicit CLI port, configured port, and default fallback.
 * @returns One port for an explicit request, or up to 20 consecutive ports
 *   starting at the configured or fallback value and stopping at 65535.
 * @remarks
 * An explicit port is strict: a busy port must fail rather than silently
 * moving the viewer to another address. Automatic selection offers a bounded
 * search so the reported URL remains predictable.
 */
export function portCandidates(input: { readonly explicit?: number; readonly configured: number; readonly fallback: number }): readonly number[] {
  const start = input.explicit ?? input.configured ?? input.fallback;

  if (input.explicit !== undefined) {
    return [input.explicit];
  }

  const candidates: number[] = [];
  for (let i = 0; i < 20; i++) {
    const port = start + i;
    if (port > 65535) {
      break;
    }
    candidates.push(port);
  }
  return candidates;
}
