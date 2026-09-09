# Configuration reference

## `ai.maxGenerateAttempts`

Maximum provider attempts for one prompt during `generate` when local validation rejects a response. The accepted range is 1–5 and the default is 2. It applies only to `generate`; heal Stage 3 always uses one attempt.

## `heal.maxStepRepairs`

Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.

## `heal.caseTimeoutMs`

Case-wide deadline for one healing case. It is an admission boundary for starting a new repair phase or dispatch — reaching it does not interrupt work already in flight or invalidate a commit already produced.
