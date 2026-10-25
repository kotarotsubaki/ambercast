import { appendFile } from 'node:fs/promises';
import { PlanDocument } from '#core/ir/schema.js';
import type { AiExecutor } from '#ports/ai.js';
import { reportError } from '#report/error-mapping.js';
import { generate } from '#usecases/generate.js';
import { createScenario, DEFAULT_OPTIONS, withSecretConfig, writePrompt } from './generate-scenario.js';

export const CONFIRMS_LIVE_CASES = {
  P: 'Open the sign-in page at /sign-in. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
  N1: 'Open the sign-in page at /sign-in. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the "Sign out" button is displayed.',
  N2: 'Open the sign-in page at /sign-in. The browser autofills the username and password. Type "verifier" into the search box, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
  N3: 'Open the sign-in page at /sign-in. Enter the username "alice", then replace it with the username "verifier". Enter the saved password and click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
} as const;

export const CONFIRMS_LIVE_ATTEMPTS = 9;
export const CONFIRMS_LIVE_MIN_PASSES = 6;
export type ConfirmsLiveCause = 'ok' | 'selection' | 'identity' | 'generation';

type LiveCase = keyof typeof CONFIRMS_LIVE_CASES;
interface ScoringStep {
  readonly id: string;
  readonly kind: string;
  readonly action?: string | undefined;
  readonly value?: string | undefined;
  readonly check?: string | undefined;
  readonly text?: string | undefined;
  readonly intent?: { readonly quote?: { readonly text: string } | undefined } | undefined;
  readonly confirms?: readonly string[] | undefined;
}

export function scoreConfirmsLiveCase(name: LiveCase, steps: readonly ScoringStep[]): {
  cause: Exclude<ConfirmsLiveCause, 'generation'>;
  assertId?: string;
  confirms: readonly string[];
  fillIds: readonly string[];
} {
  // Only the requested assertion can supply evidence for this prompt.
  const assertions = steps.filter(step => step.kind === 'assert' && (name === 'N1'
    ? step.check === 'element-visible' && step.intent?.quote?.text === 'Sign out'
    : step.check === 'text-visible' && step.text === 'Signed in as verifier'));
  const assertion = assertions.length === 1 ? assertions[0] : undefined;
  const fills = (value: string) => steps.filter(step => step.kind === 'action' && step.action === 'fill' && step.value === value);
  const verifier = fills('verifier');
  const other = name === 'N3' ? fills('alice') : name === 'N2' ? []
    : steps.filter(step => step.kind === 'action' && step.action === 'fill-secret');
  const evidence = {
    ...(assertion === undefined ? {} : { assertId: assertion.id }),
    confirms: assertion?.confirms ?? [],
    fillIds: [...verifier, ...other].map(step => step.id),
  };
  if (assertion === undefined || verifier.length !== 1 || (name !== 'N2' && other.length !== 1)) {
    return { cause: 'identity', ...evidence };
  }
  const confirmed = new Set(evidence.confirms);
  const verifierConfirmed = confirmed.has(verifier[0]!.id);
  const otherConfirmed = other.some(step => confirmed.has(step.id));
  const matches = name === 'P' ? verifierConfirmed && otherConfirmed
    : name === 'N1' ? !verifierConfirmed && !otherConfirmed
      : name === 'N2' ? !verifierConfirmed : verifierConfirmed && !otherConfirmed;
  return { cause: matches ? 'ok' : 'selection', ...evidence };
}

export function matchesConfirmsLiveCase(name: LiveCase, steps: readonly ScoringStep[]): boolean {
  return scoreConfirmsLiveCase(name, steps).cause === 'ok';
}

export interface ConfirmsLiveAttemptRecord {
  prompt: LiveCase;
  attempt: number;
  status: string | null;
  aiCalls: number | null;
  errorCode: string | null;
  cause: ConfirmsLiveCause;
  assertId: string | null;
  confirms: string[];
  fillIds: string[];
}

export async function runConfirmsLiveAttempts(executor: AiExecutor, name: LiveCase): Promise<{
  records: readonly ConfirmsLiveAttemptRecord[];
  passes: number;
}> {
  const records: ConfirmsLiveAttemptRecord[] = [];
  for (let attempt = 1; attempt <= CONFIRMS_LIVE_ATTEMPTS; attempt += 1) {
    const record: ConfirmsLiveAttemptRecord = {
      prompt: name, attempt, status: null, aiCalls: null, errorCode: null,
      cause: 'generation', assertId: null, confirms: [], fillIds: [],
    };
    try {
      // A fresh store prevents reuse from masquerading as another provider interpretation.
      const { deps } = createScenario({ resolveAiExecutor: async () => executor });
      const secretDeps = withSecretConfig(deps, '*');
      const liveDeps = { ...secretDeps, config: { ...secretDeps.config, ai: { ...secretDeps.config.ai, timeoutMs: 300_000 } } };
      const file = await writePrompt(liveDeps.storage, 'login.test.md', `# Sign in\n\n${CONFIRMS_LIVE_CASES[name]}\n`);
      const outcome = await generate(liveDeps, { ...DEFAULT_OPTIONS, files: [file], maxAttempts: 2 });
      const result = outcome.results[0];
      record.status = result?.status ?? null;
      record.aiCalls = result?.aiCalls ?? null;
      if (result?.status === 'failed' && result.error !== undefined) {
        record.errorCode = reportError(result.error, { scope: 'case', caseId: 'login' }).code;
      }
      if (result?.status === 'generated' && (result.aiCalls ?? 0) >= 1) {
        const plan = PlanDocument.parse(JSON.parse(await liveDeps.storage.readText(liveDeps.layout.planPathFor(file))));
        const score = scoreConfirmsLiveCase(name, plan.steps);
        record.cause = score.cause;
        record.assertId = score.assertId ?? null;
        record.confirms = [...score.confirms];
        record.fillIds = [...score.fillIds];
      }
    } catch {
      // Authentication, transport, and invalid output consume an attempt rather than escaping the vote.
    }
    records.push(record);
    // Log I/O failures must escape rather than masquerade as generation failures.
    const logPath = process.env.AMBERCAST_CONFIRMS_LIVE_LOG;
    if (logPath) await appendFile(logPath, `${JSON.stringify(record)}\n`);
  }
  return { records, passes: records.filter(record => record.cause === 'ok').length };
}
