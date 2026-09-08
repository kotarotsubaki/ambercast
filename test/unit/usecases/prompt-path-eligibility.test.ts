import { describe, expect, it } from 'vitest';
import { PromptPathInvalidError } from '#core/errors/prompt-path-invalid-error.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import { assertPromptPathsEligible } from '#usecases/prompt-path-eligibility.js';

const TEST_DIR = '/workspace/tests';
const RUNS_DIR = '/workspace/.runs';
const MESSAGE = 'The selected prompt path is not an eligible .test.md file.';

describe('assertPromptPathsEligible', () => {
  const layout = createLayoutResolver({ testDir: TEST_DIR, runsDir: RUNS_DIR });

  it.each([
    ['an all-eligible selection', [`${TEST_DIR}/login.test.md`, `${TEST_DIR}/nested/checkout.test.md`]],
    ['an empty selection', []],
  ] as const)('returns silently for %s', (_description, files) => {
    expect(() => assertPromptPathsEligible(layout, files)).not.toThrow();
  });

  it.each([
    ['/workspace/other/login.test.md', 'outside-test-dir'],
    [`${TEST_DIR}/login.md`, 'not-test-md'],
    [`${TEST_DIR}/.test.md`, 'no-name'],
  ] as const)('throws the unrelativized path and %s reason for %s', (path, reason) => {
    let thrown: unknown;

    try {
      assertPromptPathsEligible(layout, [path]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PromptPathInvalidError);
    expect(thrown).toMatchObject({ message: MESSAGE, details: { path, reason } });
  });

  it('reports the first ineligible path in selection order rather than the highest-priority reason in the batch', () => {
    const firstPath = `${TEST_DIR}/.test.md`;
    const laterPath = '/workspace/other/login.test.md';

    expect(() => assertPromptPathsEligible(layout, [firstPath, laterPath])).toThrow(expect.objectContaining({
      message: MESSAGE,
      details: { path: firstPath, reason: 'no-name' },
    }));
  });
});
