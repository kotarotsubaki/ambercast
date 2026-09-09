# Configuration reference

## `ai.maxGenerateAttempts`

Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

## `ai.timeoutMs`

Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.

## `heal.maxStepRepairs`

Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.

## `heal.caseTimeoutMs`

Case-wide deadline for one healing case. It is an admission boundary for starting a new repair phase or dispatch — reaching it does not interrupt work already in flight or invalidate a commit already produced.
