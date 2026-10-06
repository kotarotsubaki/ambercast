import { ReportEnvelope } from '#report/schema.js';
import { summarizeReport } from '#report/summarize.js';
import type { ReportSummaryInput } from '#report/summarize.js';
import type {
	ReportError,
	RunResult,
} from '#report/schema.js';

/** A storage snapshot whose opaque path is used only to identify a disclosure. */
export type ScannedArtifact = { path: string; bytes: Uint8Array };

/**
 * Canonical generic error messages that require supporting details to be diagnosable.
 *
 * @remarks
 * These ten messages reflect the report producers' current fallback vocabulary.
 * Producer wording changes must update this list together with the source-text
 * contract test, so a new or removed fallback cannot silently escape scrutiny.
 */
export const GENERIC_FALLBACK_MESSAGES: readonly string[] = [
	'The run command crashed unexpectedly.',
	'The generate command crashed unexpectedly.',
	'The check command crashed unexpectedly.',
	'The heal command crashed unexpectedly.',
	'Healing regeneration failed.',
	'Healing failed for this case.',
	'Secret rename validation crashed unexpectedly.',
	'Report finalization failed schema validation.',
	'The AI provider call failed.',
	'The AI-directed interaction did not complete successfully.',
];

/**
 * Shared assertion error format: function name followed by violation count,
 * then '- ' prefixed lines for each violation message.
 *
 * @param fnName - The function name to prefix the error with.
 * @param violations - Ordered list of violation messages.
 */
function throwIfViolations(fnName: string, violations: string[]): void {
	if (violations.length === 0) return;
	const message = `${fnName}: ${violations.length} violation(s)\n${violations.map(v => `- ${v}`).join('\n')}`;
	throw new Error(message);
}

/**
 * Asserts that a report is valid and gives evidence for every actionable failure.
 *
 * @param report - Candidate report envelope, accepted as unknown for schema validation.
 * @throws An error prefixed with this function's name when validation or evidence checks fail.
 * @remarks
 * Validate the envelope before inspecting its contents; schema issues become ordered
 * path/message violations, one per issue, in the schema's own order. Then inspect
 * errors in index order: a blank message, or a generic fallback message carrying no
 * supporting details, is not actionable on its own. Classify each result in
 * isolation by calling the shared summarizer with its command, that single result,
 * and no errors, so one row's classification can never be swayed by another row.
 * Match case-scoped errors to a result by identifier before applying evidence rules.
 *
 * A run result classified as errored needs a matching case error; a free-text
 * explanation alone is insufficient evidence. A failed run result needs either a
 * matching case error or a failed assertion step whose expected and actual text are
 * both nonblank. A failed generate result needs a matching case error. Failed heal,
 * check, and review results impose no additional evidence requirement, because their
 * own status and application fields are already the diagnostic code for that
 * classification. Independently of its summary classification, an executed run
 * result with an error-status step, or a failed step whose kind is environment,
 * still needs a matching case error — a result can fail this rule even while passing
 * the classification-based rule above. Listed and skipped run results carry no steps
 * and are therefore exempt from this per-step rule. A case error with no matching
 * result, and a report with empty results and empty errors, both remain valid: there
 * is nothing to diagnose, so nothing is missing.
 *
 * Accumulate violations from envelope errors before result rows, preserving each
 * one's array order, and record at most one violation per result row even when it
 * fails several evidence rules at once — the violation message for that row names
 * every unmet requirement together. The shared assertion-error format used by every
 * exported assertion in this module carries the function name and the full ordered
 * violation list, never a partial result.
 */
export function assertDiagnosable(report: unknown): void {
	// Parse envelope and collect schema violations
	const parseResult = ReportEnvelope.safeParse(report);
	const violations: string[] = [];

	if (!parseResult.success) {
		for (const issue of parseResult.error.issues) {
			const path = issue.path.length === 0 ? 'report' : issue.path.join('.');
			violations.push(`${path}: ${issue.message}`);
		}
	}

	// Get the parsed data for further inspection
	if (!parseResult.success) {
		throwIfViolations('assertDiagnosable', violations);
		throw new Error('unreachable: schema validation failures always produce at least one violation');
	}
	const parsed = parseResult.data;

	// Collect case-scoped errors for matching
	const caseErrorsByCaseId = new Map<string, ReportError>();
	for (const error of parsed.errors) {
		if (error.scope === 'case') {
			caseErrorsByCaseId.set(error.caseId, error);
		}
	}

	// Inspect errors in index order (already in order from schema validation)
	// Check for blank messages and generic fallback messages without details
	for (const [i, error] of parsed.errors.entries()) {
		// ① Blank message is a violation
		if (error.message.trim() === '') {
			violations.push(`errors[${i}]: message is blank`);
		}
		// ② Generic fallback without details is a violation
		else if (GENERIC_FALLBACK_MESSAGES.includes(error.message) && ('details' in error ? error.details : undefined) === undefined) {
			violations.push(`errors[${i}]: generic fallback message without details (code: ${error.code})`);
		}
	}

	// Process each result
	for (const result of parsed.results) {
		const caseId = result.id;

		// Classify the result using summarizeReport with single result
		const summary = summarizeReport({
			command: parsed.command,
			results: [result],
			errors: [],
		} as ReportSummaryInput);

		// Get classification from summary (exactly one of these will be 1)
		const isErrored = summary.errored === 1;
		const isFailed = summary.failed === 1;

		// Collect reasons for this result row
		const reasons: string[] = [];

		// For run command, check step-level requirements
		if (parsed.command === 'run' && 'status' in result && result.status !== 'listed' && result.status !== 'skipped') {
			const runResult = result as RunResult;

			// A run result classified as errored needs a matching case error
			if (isErrored && !caseErrorsByCaseId.has(caseId)) {
				reasons.push('errored run result lacks matching case error');
			}

			if ('steps' in runResult) {
				const hasIndependentlyFailingStep = runResult.steps.some(
					step => step.status === 'error' || (step.status === 'failed' && step.kind === 'environment')
				);
				if (hasIndependentlyFailingStep && !caseErrorsByCaseId.has(caseId)) {
					reasons.push('result has an error-status or failed-environment step but lacks matching case error');
				}
			}

			// A failed run result needs either a matching case error or a failed assertion step
			// with both expected and actual non-blank
			if (isFailed) {
				if ('steps' in runResult && Array.isArray(runResult.steps)) {
					const hasValidFailedStep = runResult.steps.some(
						step => step.status === 'failed' && step.kind === 'assertion' && step.expected?.trim() && step.actual?.trim()
					);
					if (!hasValidFailedStep && !caseErrorsByCaseId.has(caseId)) {
						reasons.push('failed run result lacks matching case error and has no valid failed assertion step');
					}
				} else if (!caseErrorsByCaseId.has(caseId)) {
					reasons.push('failed run result lacks matching case error');
				}
			}
		}

		// A failed generate result needs a matching case error
		if (isFailed && parsed.command === 'generate' && !caseErrorsByCaseId.has(caseId)) {
			reasons.push('failed generate result lacks matching case error');
		}

		// Add one violation per result row (if any reasons)
		if (reasons.length > 0) {
			violations.push(`${JSON.stringify(caseId)}: ${reasons.join('; ')}`);
		}
	}

	throwIfViolations('assertDiagnosable', violations);
}

/**
 * Asserts that a report records no AI calls during replay.
 *
 * @param report - Candidate report envelope, accepted as unknown for schema validation.
 * @throws An error prefixed with this function's name for invalid input or violations.
 * @remarks
 * Parse the envelope the same way {@link assertDiagnosable} does. An empty result
 * array is itself a report-level violation, located at the report rather than any
 * row, because a command report with nothing replayed cannot demonstrate zero AI
 * usage. Every executed run result — passed, failed, or error — must explicitly
 * carry an `aiCalls` field equal to zero; an absent field counts as a violation on
 * these rows rather than as silently compliant. Listed or skipped run results, and
 * every row from a non-run command, may omit the field, but whichever value they do
 * carry must still be zero. Finally, the report as a whole must contain at least one
 * row that carries `aiCalls`, so an all-omitted report (for example, a `check`-only
 * or `--list`-only report) cannot vacuously satisfy this assertion. Violations
 * accumulate through the same shared error format as the other assertions in this
 * module.
 */
export function assertZeroAiCalls(report: unknown): void {
	// Parse envelope and collect schema violations
	const parseResult = ReportEnvelope.safeParse(report);
	const violations: string[] = [];

	if (!parseResult.success) {
		for (const issue of parseResult.error.issues) {
			const path = issue.path.length === 0 ? 'report' : issue.path.join('.');
			violations.push(`${path}: ${issue.message}`);
		}
	}

	if (!parseResult.success) {
		throwIfViolations('assertZeroAiCalls', violations);
		throw new Error('unreachable: schema validation failures always produce at least one violation');
	}
	const parsed = parseResult.data;

	// An empty result array is a report-level violation
	if (parsed.results.length === 0) {
		violations.push('report: empty results array - cannot demonstrate zero AI usage');
		throwIfViolations('assertZeroAiCalls', violations);
	}

	// Track if any result has aiCalls field
	let hasAiCallsField = false;
	// Track results that violate the aiCalls requirement

	for (const result of parsed.results) {
		const caseId = result.id;

		// Check if result is an executed run result (passed, failed, error)
		if (parsed.command === 'run' && 'status' in result) {
			const status = result.status;
			const isExecutedRun = status === 'passed' || status === 'failed' || status === 'error';

			const runResult = result as RunResult;

			if (isExecutedRun) {
				// Check for aiCalls field
				if ('aiCalls' in runResult) {
					hasAiCallsField = true;
					if (runResult.aiCalls !== 0) {
						violations.push(`${caseId}: aiCalls is ${runResult.aiCalls}, expected 0`);
					}
				} else {
					// Absent field counts as violation for executed run results
					violations.push(`${caseId}: missing aiCalls field`);
				}
			} else {
				// Listed or skipped run results may omit the field
				// If present, it must be zero
				if ('aiCalls' in runResult) {
					hasAiCallsField = true;
					if (runResult.aiCalls !== 0) {
						violations.push(`${caseId}: aiCalls is ${runResult.aiCalls}, expected 0`);
					}
				}
			}
		} else {
			// Non-run commands: may omit the field, but if present must be zero
			if ('aiCalls' in result) {
				hasAiCallsField = true;
				if ((result as { aiCalls?: number }).aiCalls !== 0) {
					violations.push(`${caseId}: aiCalls is ${(result as { aiCalls?: number }).aiCalls}, expected 0`);
				}
			}
		}
	}

	// The report as a whole must contain at least one row with aiCalls
	if (!hasAiCallsField) {
		violations.push('report: no row carries aiCalls field - cannot demonstrate zero AI usage');
	}

	throwIfViolations('assertZeroAiCalls', violations);
}

/**
 * Asserts that report text and storage snapshots disclose none of the given secrets.
 *
 * @param input - Nonempty labeled secret values and at least one report or artifact to scan.
 * @throws An invalid-input error, named with this function's own name, for a malformed
 *   `secrets` map, no scan target, a report that cannot be turned into scannable text, or
 *   an `artifacts` entry whose shape does not match {@link ScannedArtifact}; otherwise
 *   throws the aggregated disclosure violations.
 * @remarks
 * Validate the call shape before scanning anything, because a scan performed on an
 * ambiguous input could itself under-report: reject an empty `secrets` map, any empty
 * secret value, and any substring overlap between distinct labels or values, since
 * that overlap would make a later finding's label ambiguous. Reject the call when
 * there is no `report` and no `artifacts`, and when `artifacts` holds an entry whose
 * `path` is not a string or whose `bytes` is not a `Uint8Array`. None of these
 * rejection messages repeat the offending label or value, since the whole point of
 * this function is to avoid echoing secrets.
 *
 * Scan a string `report` exactly as given. Scan any other `report` by serializing it
 * to JSON first, rejecting a value that throws during serialization (for example a
 * circular structure) or serializes to `undefined`. Search each scan target's bytes
 * independently for a secret's raw UTF-8 form and for its JSON-escaped form, and when
 * both appear, report only the smaller of the two byte offsets — the two forms are
 * alternate encodings of the same disclosure, not two disclosures. A secret found
 * inside an artifact's `path` is reported as an additional, separate finding located
 * at that artifact's index rather than at its path string, specifically so the path
 * text — which would itself disclose the secret — never has to appear in a violation
 * message; that artifact's content is still scanned and reported independently, even
 * when the path finding and a content finding share the same secret.
 */
export function assertNoSecretDisclosure(input: { secrets: Record<string, string>; report?: unknown; artifacts?: readonly ScannedArtifact[] }): void {
	const { secrets, report, artifacts } = input;

	if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) || Object.keys(secrets).length === 0) {
		throw new Error('assertNoSecretDisclosure: invalid input: secrets is empty');
	}

	for (const value of Object.values(secrets)) {
		if (typeof value !== 'string' || value === '') {
			throw new Error('assertNoSecretDisclosure: invalid input: secret value is empty');
		}
	}

	const labels = Object.keys(secrets);
	const values = Object.values(secrets);
	const pool = [...labels, ...values];
	for (let i = 0; i < pool.length; i++) {
		for (let j = 0; j < pool.length; j++) {
			if (i === j) continue;
			if (i < labels.length && j < labels.length) continue;
			if (pool[i]!.includes(pool[j]!)) {
				throw new Error('assertNoSecretDisclosure: invalid input: a label contains a secret value');
			}
		}
	}

	if (report === undefined && (artifacts === undefined || artifacts.length === 0)) {
		throw new Error('assertNoSecretDisclosure: invalid input: no scan target provided');
	}

	if (artifacts !== undefined) {
		for (const artifact of artifacts) {
			if (typeof artifact.path !== 'string') {
				throw new Error('assertNoSecretDisclosure: invalid input: artifact path is not a string');
			}
			if (!(artifact.bytes instanceof Uint8Array)) {
				throw new Error('assertNoSecretDisclosure: invalid input: artifact bytes is not a Uint8Array');
			}
		}
	}

	const targets: { text: string | Buffer; locationName: string; isArtifact?: boolean; artifactIndex?: number; pathContainsSecret?: boolean }[] = [];

	if (report !== undefined) {
		let reportText: string;
		if (typeof report === 'string') {
			reportText = report;
		} else {
			try {
				const json = JSON.stringify(report);
				if (json === undefined) {
					throw new Error('assertNoSecretDisclosure: invalid input: report could not be serialized');
				}
				reportText = json;
			} catch {
				throw new Error('assertNoSecretDisclosure: invalid input: report could not be serialized');
			}
		}
		targets.push({ text: reportText, locationName: 'report' });
	}

	const artifactPathContainsSecret = (artifact: { path: string; bytes: Uint8Array }): boolean => {
		const pathBuffer = Buffer.from(artifact.path, 'utf8');
		for (const value of Object.values(secrets)) {
			const valueBuffer = Buffer.from(value, 'utf8');
			if (pathBuffer.indexOf(valueBuffer) >= 0) {
				return true;
			}
			const jsonStringValue = JSON.stringify(value);
			const jsonEscapedValue = jsonStringValue.slice(1, -1);
			if (jsonEscapedValue !== value) {
				const jsonEscapedBuffer = Buffer.from(jsonEscapedValue, 'utf8');
				if (pathBuffer.indexOf(jsonEscapedBuffer) >= 0) {
					return true;
				}
			}
		}
		return false;
	};

	if (artifacts !== undefined) {
		for (const [i, artifact] of artifacts.entries()) {
			// An indexed location keeps a disclosed secret in the path out of the error message.
			const pathContainsSecret = artifactPathContainsSecret(artifact);
			const locationName = pathContainsSecret ? `artifacts[${i}]` : artifact.path;
			targets.push({ text: Buffer.from(artifact.bytes), locationName, isArtifact: true, artifactIndex: i, pathContainsSecret });
		}
	}

	const violations: string[] = [];

	for (const [label, value] of Object.entries(secrets)) {
		const valueBuffer = Buffer.from(value, 'utf8');

		for (const target of targets) {
			const text = target.text;

			const targetBuffer = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');

			const rawOffset = targetBuffer.indexOf(valueBuffer);

			const jsonStringValue = JSON.stringify(value);
			const jsonEscapedValue = jsonStringValue.slice(1, -1);
			const jsonEscapedBuffer = Buffer.from(jsonEscapedValue, 'utf8');

			let jsonOffset = -1;
			if (jsonEscapedValue !== value) {
				jsonOffset = targetBuffer.indexOf(jsonEscapedBuffer);
			}

			let offset = -1;
			if (rawOffset >= 0 && jsonOffset >= 0) {
				offset = Math.min(rawOffset, jsonOffset);
			} else if (rawOffset >= 0) {
				offset = rawOffset;
			} else if (jsonOffset >= 0) {
				offset = jsonOffset;
			}

			if (offset >= 0) {
				if (target.isArtifact && target.artifactIndex !== undefined) {
					violations.push(`secret ${label} found in ${target.locationName} at offset ${offset}`);
				} else {
					violations.push(`secret ${label} found in ${target.locationName} at offset ${offset}`);
				}
			}

			if (target.isArtifact && target.artifactIndex !== undefined) {
				const artifact = artifacts![target.artifactIndex]!;
				const pathBuffer = Buffer.from(artifact.path, 'utf8');
				if (pathBuffer.indexOf(valueBuffer) >= 0) {
					violations.push(`secret ${label} found in path of artifacts[${target.artifactIndex}]`);
				}
				else if (jsonEscapedValue !== value) {
					if (pathBuffer.indexOf(jsonEscapedBuffer) >= 0) {
						violations.push(`secret ${label} found in path of artifacts[${target.artifactIndex}]`);
					}
				}
			}
		}
	}

	throwIfViolations('assertNoSecretDisclosure', violations);
}

/**
 * Collects storage snapshots across one or more roots for secret-disclosure checks.
 *
 * @param storage - Storage adapter used only for existence, listing, and binary reads;
 *   this collector never calls any of its write methods.
 * @param roots - Opaque file or directory roots to inspect; at least one is required.
 * @returns Every distinct collected artifact, ordered by JavaScript's default string
 *   sort (UTF-16 code unit order) over the path.
 * @throws An invalid-input error for an empty `roots` array, for a `roots` entry that
 *   is not a string, or when a root yields no files at all; a read failure during
 *   collection rejects immediately as `cannot read <path, JSON-stringified>: <the
 *   original failure's message>`, never a partial result.
 * @remarks
 * Treat each root as a single file when the adapter reports it as an existing file;
 * otherwise descend into it through the adapter's listing methods, recursing into
 * every subdirectory they report. Include files named with the adapter's
 * `.ambercast-tmp-` write-staging prefix even though ordinary callers of the storage
 * port are expected to ignore them: those leftovers can still contain a secret, and
 * this collector exists specifically to find that kind of disclosure, so it is a
 * deliberate, scoped exception to the general ignore convention rather than an
 * oversight. When two roots overlap (one root nested in another, or the same root
 * repeated), deduplicate the final result by path so the returned array never
 * contains two entries for the same path, even when roots overlap or repeat.
 */
export async function collectStorageArtifacts(storage: import('#ports/storage.js').StorageAdapter, roots: readonly string[]): Promise<ScannedArtifact[]> {
	// Validate input: roots must not be empty
	if (roots.length === 0) {
		throw new Error('collectStorageArtifacts: invalid input: roots is empty');
	}

	// Validate input: all roots must be strings
	for (const root of roots) {
		if (typeof root !== 'string') {
			throw new Error('collectStorageArtifacts: invalid input: a root is not a string');
		}
	}

	// Collect results in a Map for deduplication
	const artifactsMap = new Map<string, Uint8Array>();

	// Process each root
	for (const root of roots) {
		const rootArtifacts = new Map<string, Uint8Array>();

		// Check if root is a file (exists) or directory
		const isFile = await storage.exists(root);

		if (isFile) {
			// Treat as a single file
			try {
				const bytes = await storage.readBinary(root);
				rootArtifacts.set(root, bytes);
			} catch (e) {
				const originalMessage = e instanceof Error ? e.message : String(e);
				throw new Error(`collectStorageArtifacts: cannot read ${JSON.stringify(root)}: ${originalMessage}`);
			}
		} else {
			// Recursively descend into directory
			const collectFromDir = async (dir: string) => {
				// List files in current directory
				const files = await storage.listFiles(dir);
				for (const name of files) {
					const path = dir === '' ? name : `${dir}/${name}`;
					try {
						const bytes = await storage.readBinary(path);
						rootArtifacts.set(path, bytes);
					} catch (e) {
						const originalMessage = e instanceof Error ? e.message : String(e);
						throw new Error(`collectStorageArtifacts: cannot read ${JSON.stringify(path)}: ${originalMessage}`);
					}
				}

				// Recurse into subdirectories
				const directories = await storage.listDirectories(dir);
				for (const name of directories) {
					const path = dir === '' ? name : `${dir}/${name}`;
					await collectFromDir(path);
				}
			};

			try {
				await collectFromDir(root);
			} catch (e) {
				// Re-throw read errors with proper prefix
				throw e;
			}
		}

		// Check if this root yielded any files
		if (rootArtifacts.size === 0) {
			throw new Error(`collectStorageArtifacts: root ${JSON.stringify(root)} contained no files`);
		}

		// Merge into main map (deduplication)
		for (const [path, bytes] of rootArtifacts) {
			artifactsMap.set(path, bytes);
		}
	}

	// Convert to array and sort by path (UTF-16 code unit order, JavaScript default)
	const result: ScannedArtifact[] = [];
	for (const [path, bytes] of artifactsMap) {
		result.push({ path, bytes });
	}
	result.sort((a, b) => {
		if (a.path < b.path) return -1;
		if (a.path > b.path) return 1;
		return 0;
	});

	return result;
}
