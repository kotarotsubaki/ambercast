import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createClaudeCodeCliExecutor } from '#adapters/ai/claude-code-cli/index.js';
import { createSpawnCommandRunner } from '#adapters/ai/shared/command-runner.js';
import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { ElementBindingProposalResponse } from '#core/ir/schema.js';
import { buildGeneratorTask } from '#core/ai/prompt-envelope.js';
import { buildRedactedAiProposalContext } from '#usecases/run.js';
import type { JsonValueT } from '#core/ir/schema.js';
import { CONFIRMS_LIVE_MIN_PASSES, runConfirmsLiveAttempts } from '../support/confirms-live-check.js';
import { countAmbiguityLiveOutcomes } from '../support/ambiguity-live-check.js';

let available = false;

describe('claude-code-cli smoke contract', () => {
  it('#600 ambiguity live check S: single target, path-less prompt does not stop on ambiguity', async context => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const result = await countAmbiguityLiveOutcomes(createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) }), 'S');
    const { records: _records, ...counts } = result;
    expect(result.passed, JSON.stringify(counts)).toBe(true);
  }, 2_700_000);

  it('#600 ambiguity live check M: genuinely ambiguous multi-target prompt stops with PROMPT_AMBIGUOUS', async context => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const result = await countAmbiguityLiveOutcomes(createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) }), 'M');
    const { records: _records, ...counts } = result;
    expect(result.passed, JSON.stringify(counts)).toBe(true);
  }, 2_700_000);

  it('Issue #596 TEST-14 identifies an unnamed memo editor in two of three validated responses', async context => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const executor = createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) });
    const proposalContext = buildRedactedAiProposalContext({ description: 'Memo editor', roleHint: 'textbox', excerpt: 'Fill the memo editor.', accessibilityTree: { role: 'root', name: '', children: [{ role: 'textbox', name: 'User', children: [] }, { role: 'textbox', name: '', children: [] }] } }, new Map(), new Map()) as JsonValueT;
    let matches = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await executor.execute({ prompt: buildGeneratorTask('Identify the exact accessible element matching the supplied description, quote, and role hint in the accessibility tree. If that element has no accessible name, return its role with an empty name (""). Return one ElementBindingProposal outcome. Put it under the "proposal" key.'), context: proposalContext, responseSchema: typedJsonSchema(ElementBindingProposalResponse) });
      if (result.data.proposal.outcome === 'found' && result.data.proposal.role === 'textbox' && result.data.proposal.name === '') matches += 1;
    }
    expect(matches).toBeGreaterThanOrEqual(2);
  });
  beforeAll(async () => {
    available = await createClaudeCodeCliExecutor({
      run: createSpawnCommandRunner({ env: process.env }),
    }).isAvailable();
  });

  // Availability is the only skip condition. A running provider call must
  // surface protocol and schema regressions as test failures.
  it('returns a validated trivial structured response from the live provider protocol', async (context) => {
    if (!available) {
      context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    }

    const executor = createClaudeCodeCliExecutor({
      run: createSpawnCommandRunner({ env: process.env }),
    });
    await expect(executor.execute({
      prompt: 'Respond with {"ok": true}.',
      responseSchema: typedJsonSchema(z.object({ ok: z.boolean() })),
    })).resolves.toMatchObject({ data: { ok: true } });
  });

  it('Issue #583 TEST-7 returns a validated element-binding proposal for the Save button question', async (context) => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const executor = createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) });
    const result = await executor.execute({
      prompt: 'Accessibility tree: [button "Save"] [textbox (no name)] [link "Home"]. Which element is the Save button? Answer under "proposal".',
      responseSchema: typedJsonSchema(ElementBindingProposalResponse),
    });
    expect(['found', 'none', 'ambiguous']).toContain(result.data.proposal.outcome);
  });

  it('Issue #598 TEST-11 P passes at least six of nine independent generations', async (context) => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const executor = createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) });
    const { passes } = await runConfirmsLiveAttempts(executor, 'P');
    expect(passes).toBeGreaterThanOrEqual(CONFIRMS_LIVE_MIN_PASSES);
  }, 2_700_000);

  it('Issue #598 TEST-11 N1 passes at least six of nine independent generations', async (context) => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const executor = createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) });
    const { passes } = await runConfirmsLiveAttempts(executor, 'N1');
    expect(passes).toBeGreaterThanOrEqual(CONFIRMS_LIVE_MIN_PASSES);
  }, 2_700_000);

  it('Issue #598 TEST-11 N2 passes at least six of nine independent generations', async (context) => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const executor = createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) });
    const { passes } = await runConfirmsLiveAttempts(executor, 'N2');
    expect(passes).toBeGreaterThanOrEqual(CONFIRMS_LIVE_MIN_PASSES);
  }, 2_700_000);

  it('Issue #598 TEST-11 N3 passes at least six of nine independent generations', async (context) => {
    if (!available) context.skip('The Claude CLI is unavailable for the opt-in live smoke check.');
    const executor = createClaudeCodeCliExecutor({ run: createSpawnCommandRunner({ env: process.env }) });
    const { passes } = await runConfirmsLiveAttempts(executor, 'N3');
    expect(passes).toBeGreaterThanOrEqual(CONFIRMS_LIVE_MIN_PASSES);
  }, 2_700_000);
});
