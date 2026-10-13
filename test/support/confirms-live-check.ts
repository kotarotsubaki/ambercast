import { PlanDocument } from '#core/ir/schema.js';
import type { AiExecutor } from '#ports/ai.js';
import { generate } from '#usecases/generate.js';
import { createScenario, DEFAULT_OPTIONS, withSecretConfig, writePrompt } from './generate-scenario.js';

export const CONFIRMS_LIVE_CASES = {
  P: 'Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
  N1: 'Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the "Sign out" button is displayed.',
  N2: 'Open the sign-in page. The browser autofills the username and password. Type "verifier" into the search box, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
  N3: 'Open the sign-in page. Enter the username "alice", then replace it with the username "verifier". Enter the saved password and click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
} as const;

type LiveCase = keyof typeof CONFIRMS_LIVE_CASES;
interface ScoringStep {
  readonly id: string;
  readonly kind: string;
  readonly action?: string | undefined;
  readonly value?: string | undefined;
  readonly confirms?: readonly string[] | undefined;
}

export function matchesConfirmsLiveCase(name: LiveCase, steps: readonly ScoringStep[]): boolean {
  const confirmed = new Set(steps.flatMap(step => step.kind === 'assert' || step.kind === 'ai' ? step.confirms ?? [] : []));
  const fills = (value: string) => steps.filter(step => step.kind === 'action' && step.action === 'fill' && step.value === value);
  const verifier = fills('verifier');
  if (verifier.length !== 1) return false;
  const verifierConfirmed = confirmed.has(verifier[0]!.id);
  if (name === 'N2') return !verifierConfirmed;
  if (name === 'N3') {
    const alice = fills('alice');
    return alice.length === 1 && !confirmed.has(alice[0]!.id) && verifierConfirmed;
  }
  const passwords = steps.filter(step => step.kind === 'action' && step.action === 'fill-secret');
  if (passwords.length !== 1) return false;
  const passwordConfirmed = confirmed.has(passwords[0]!.id);
  return name === 'P' ? verifierConfirmed && passwordConfirmed : !verifierConfirmed && !passwordConfirmed;
}

export async function countConfirmsLiveMatches(executor: AiExecutor, name: LiveCase): Promise<number> {
  let matches = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A fresh store prevents reuse from masquerading as another provider interpretation.
    const { deps } = createScenario({ resolveAiExecutor: async () => executor });
    const secretDeps = withSecretConfig(deps, '*');
    const liveDeps = { ...secretDeps, config: { ...secretDeps.config, ai: { ...secretDeps.config.ai, timeoutMs: 300_000 } } };
    try {
      const file = await writePrompt(liveDeps.storage, 'login.test.md', `# Sign in\n\n${CONFIRMS_LIVE_CASES[name]}\n`);
      const outcome = await generate(liveDeps, { ...DEFAULT_OPTIONS, files: [file], maxAttempts: 1 });
      const result = outcome.results[0];
      if (result?.status !== 'generated' || (result.aiCalls ?? 0) < 1) continue;
      const plan = PlanDocument.parse(JSON.parse(await liveDeps.storage.readText(liveDeps.layout.planPathFor(file))));
      if (matchesConfirmsLiveCase(name, plan.steps)) matches += 1;
    } catch {
      // Authentication, transport, and invalid output consume an attempt rather than escaping the vote.
    }
  }
  return matches;
}
