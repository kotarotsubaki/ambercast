import { appendFile } from 'node:fs/promises';
import type { AiExecutor } from '#ports/ai.js';
import { reportError } from '#report/error-mapping.js';
import { generate } from '#usecases/generate.js';
import { createScenario, DEFAULT_OPTIONS, withSecretConfig, writePrompt } from './generate-scenario.js';

export const AMBIGUITY_LIVE_PROMPTS = {
  S: 'Open the sign-in page. Enter the username "verifier" and the saved password, then click "Sign in". Assert that the text "Signed in as verifier" is displayed.',
  M: 'Open the settings page and click "Save". Assert that the text "Saved" is displayed.',
} as const;

export interface AmbiguityLiveAttemptRecord {
  provider: AiExecutor['name'];
  scenario: 'S' | 'M';
  attempt: number;
  outcome: 'generated' | 'ambiguity-failed' | 'other-failed' | 'unscored';
  status: string | null;
  errorCode: string | null;
  issuePaths: string[][];
  aiCalls: number | null;
  assumptionWarnings: number;
}

export async function countAmbiguityLiveOutcomes(executor: AiExecutor, scenario: 'S' | 'M') {
  const records: AmbiguityLiveAttemptRecord[] = [];
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const record: AmbiguityLiveAttemptRecord = {
      provider: executor.name, scenario, attempt, outcome: 'unscored', status: null,
      errorCode: null, issuePaths: [], aiCalls: null, assumptionWarnings: 0,
    };
    try {
      // Separate backing stores prevent cached plans from supplying another vote.
      const { deps } = createScenario({ resolveAiExecutor: async () => executor }, scenario === 'S' ? {} : {
        targets: {
          admin: { surface: 'web', baseUrl: 'https://admin.example.test', description: 'Administration console' },
          shop: { surface: 'web', baseUrl: 'https://shop.example.test', description: 'Customer storefront' },
        },
        defaultTarget: undefined,
      });
      const secretDeps = withSecretConfig(deps, '*');
      const liveDeps = { ...secretDeps, config: { ...secretDeps.config, ai: { ...secretDeps.config.ai, timeoutMs: 120_000 } } };
      const file = await writePrompt(liveDeps.storage, 'login.test.md', `# Live ambiguity check\n\n${AMBIGUITY_LIVE_PROMPTS[scenario]}\n`);
      const result = (await generate(liveDeps, { ...DEFAULT_OPTIONS, files: [file], maxAttempts: 2 })).results[0];
      if (result !== undefined) {
        record.status = result.status;
        record.aiCalls = result.aiCalls ?? null;
        record.assumptionWarnings = result.warnings?.filter(warning => String(warning.kind) === 'generator-assumption').length ?? 0;
        if (result.status === 'generated') record.outcome = 'generated';
        else if (result.status === 'failed' && result.error !== undefined) {
          record.errorCode = reportError(result.error, { scope: 'case', caseId: 'login' }).code;
          const issues = result.error.details?.['issues'];
          const paths: (string | number)[][] = Array.isArray(issues) ? issues.flatMap(issue => {
            if (issue === null || typeof issue !== 'object' || !('path' in issue)) return [];
            const path = issue.path;
            return Array.isArray(path) && path.every(part => typeof part === 'string' || typeof part === 'number') ? [path] : [];
          }) : [];
          const ambiguity = record.errorCode === 'PROMPT_AMBIGUOUS' || (record.errorCode === 'AI_RESPONSE_INVALID'
            && paths.some(path => path.length === 1 && path[0] === 'ambiguities'));
          // Log representation must not change the exact path used by the oracle.
          record.issuePaths = paths.map(path => path.map(String));
          record.outcome = ambiguity ? 'ambiguity-failed' : 'other-failed';
        }
      }
    } catch {
      // Unobservable or unclassifiable attempts remain in the denominator.
      record.outcome = 'unscored';
    }
    records.push(record);
    // Losing the audit record fails the check, rather than consuming a vote.
    const logPath = process.env.AMBERCAST_AMBIGUITY_LIVE_LOG;
    if (logPath) await appendFile(logPath, `${JSON.stringify(record)}\n`);
  }
  const counts = {
    generated: records.filter(record => record.outcome === 'generated').length,
    ambiguityFailed: records.filter(record => record.outcome === 'ambiguity-failed').length,
    otherFailed: records.filter(record => record.outcome === 'other-failed').length,
    unscored: records.filter(record => record.outcome === 'unscored').length,
    promptAmbiguous: records.filter(record => record.outcome === 'ambiguity-failed' && record.errorCode === 'PROMPT_AMBIGUOUS').length,
    assumptionWarnings: records.reduce((sum, record) => sum + record.assumptionWarnings, 0),
  };
  return { records, ...counts, passed: scenario === 'S'
    ? counts.ambiguityFailed === 0 && counts.unscored === 0 : counts.promptAmbiguous >= 6 };
}
