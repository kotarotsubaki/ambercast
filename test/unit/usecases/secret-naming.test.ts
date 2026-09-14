import { describe, expect, it } from 'vitest';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { PlanDocument } from '#core/ir/schema.js';
import { compareSecretWarnings, deriveSecretNames, deriveStage2ReplacementSecretNames, normalizeAiStepSecretUses, slug, type SecretWarning } from '#usecases/secret-naming.js';

const STAGE2_PLAN = PlanDocument.parse({
  schemaVersion: 3,
  source: { inputsDigest: 'a'.repeat(64) },
  targets: { web: { baseUrl: 'https://example.test', browser: 'chromium' } },
  steps: [
    { id: 'retained-fill', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, secretRef: '{{secrets.retained.fill}}' },
    { id: 'replace-me', kind: 'assert', check: 'text-visible', text: 'old assertion' },
    { id: 'retained-ai', kind: 'ai', instruction: 'keep this', instructionCoverage: [{ id: 'kept', kind: 'success', sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } }], secrets: [{ ref: '{{secrets.retained.ai}}' }] },
  ],
});

describe('slug', () => {
  it.each([
    ['Password', 'password'], ['Ｐａｓｓｗｏｒｄ', 'password'], ['Mixed CASE', 'mixed_case'], ['a---b', 'a_b'],
    ['---a---', 'a'], ['42 code', 's_42_code'], ['___', ''], ['', ''], ['東京', ''], ['hello.world', 'hello_world'],
    ['a/b', 'a_b'], ['a__b', 'a_b'], [' A ', 'a'], ['ß', ''], ['é', ''], ['foo🙂bar', 'foo_bar'],
    ['a\tb', 'a_b'], ['a\nb', 'a_b'], ['0', 's_0'], ['A1_B2', 'a1_b2'], ['x'.repeat(80), 'x'.repeat(64)],
  ])('maps %j to %j', (input, expected) => { expect(slug(input)).toBe(expected); });
});

describe('deriveSecretNames', () => {
  // SPEC-C1 C1-3
  it.each([
    ['projected allowed name', { secret: { allowedName: 'account.password' } }, { projected: ['account.password'], allowlist: [] }, '{{secrets.account.password}}', 'account.password', 'allowed-name'],
    ['target slug', {}, { projected: [], allowlist: [] }, '{{secrets.password}}', 'password', 'target-slug'],
    ['name hint after an empty target slug', { secret: { nameHint: 'password' }, target: { strategy: 'accessibility', role: 'textbox', name: '!!!' } }, { projected: [], allowlist: [] }, '{{secrets.password}}', 'password', 'hint'],
    ['ordinal fallback', { target: { strategy: 'accessibility', role: 'textbox', name: '!!!' } }, { projected: [], allowlist: [] }, '{{secrets.secret_step_1}}', 'secret_step_1', 'ordinal'],
  ] as const)('covers each fill-secret naming rung: %s', (_label, patch, sets, ref, name, selectionSource) => {
    const result = deriveSecretNames([
      { id: 'fill', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, ...patch },
    ] as never, sets as never);

    expect(result.steps[0]).toMatchObject({ secretRef: ref });
    expect(result.uses[0]).toMatchObject({ name, selectionSource });
  });

  // SPEC-C1 C1-3
  it('covers AI allowed-name, hint, and original-array ordinal naming rungs', () => {
    const result = deriveSecretNames([
      { id: 'ai', kind: 'ai', instruction: 'x', secrets: [{ allowedName: 'token' }, { nameHint: 'password' }, {}] },
    ] as never, { projected: ['token'], allowlist: [] } as never);

    expect(result.steps[0]).toMatchObject({
      secrets: [{ ref: '{{secrets.token}}' }, { ref: '{{secrets.password}}' }, { ref: '{{secrets.secret_step_1_3}}' }],
    });
    expect(result.uses).toMatchObject([
      { name: 'token', selectionSource: 'allowed-name', useIndex: 0 },
      { name: 'password', selectionSource: 'hint', useIndex: 1 },
      { name: 'secret_step_1_3', selectionSource: 'ordinal', useIndex: 2 },
    ]);
  });

  // SPEC-C1 C1-3
  it('distinguishes exact projected membership from allowlist promotion and star authorization', () => {
    const projected = deriveSecretNames([
      { id: 'projected-name', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, secret: { allowedName: 'account.password' } },
    ] as never, { projected: ['account.password'], allowlist: [] } as never);
    expect(projected.steps[0]).toMatchObject({ secretRef: '{{secrets.account.password}}' });
    expect(projected.uses[0]).toMatchObject({ name: 'account.password', selectionSource: 'allowed-name' });

    const allowlistOnly = () => deriveSecretNames([
      { id: 'allowlist-only', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, secret: { allowedName: 'account.password' } },
    ] as never, { projected: [], allowlist: ['account.password'] } as never);
    expect(allowlistOnly).toThrow(AiResponseInvalidError);
    try {
      allowlistOnly();
    } catch (error) {
      expect(error).toBeInstanceOf(AiResponseInvalidError);
      expect((error as AiResponseInvalidError).details).toMatchObject({
        issues: [{ code: 'secret-allowed-name-not-projected', path: 'steps[0].secret.allowedName', stepId: 'allowlist-only' }],
      });
    }

    const star = deriveSecretNames([
      { id: 'star-first', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card #1' } },
      { id: 'star-second', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card! 1' } },
    ] as never, { projected: [], allowlist: '*' } as never);
    expect(star.steps).toMatchObject([
      { secretRef: '{{secrets.card_1}}' },
      { secretRef: '{{secrets.card_1_2}}' },
    ]);
    expect(star.uses).toMatchObject([
      { name: 'card_1', selectionSource: 'target-slug' },
      { name: 'card_1_2', selectionSource: 'target-slug' },
    ]);
  });

  // SPEC-C1 C1-3
  it('aggregates all unprojected explicit-name issues before target collision issues in step/use order', () => {
    const derive = () => deriveSecretNames([
      { id: 'unprojected-fill', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Email' }, secret: { allowedName: 'unprojected.fill' } },
      { id: 'unprojected-ai', kind: 'ai', instruction: 'x', secrets: [{ allowedName: 'unprojected.ai' }] },
      { id: 'first-target-claim', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Shared' }, secret: { allowedName: 'first' } },
      { id: 'second-target-claim', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Shared' }, secret: { allowedName: 'second' } },
    ] as never, { projected: ['first', 'second'], allowlist: [] } as never);

    expect(derive).toThrow(AiResponseInvalidError);
    try {
      derive();
    } catch (error) {
      expect(error).toBeInstanceOf(AiResponseInvalidError);
      const issues = (error as AiResponseInvalidError).details?.issues as Array<{ code: string; path: string; stepId: string }>;
      expect(issues).toEqual([
        { code: 'secret-allowed-name-not-projected', path: 'steps[0].secret.allowedName', stepId: 'unprojected-fill' },
        { code: 'secret-allowed-name-not-projected', path: 'steps[1].secrets[0].allowedName', stepId: 'unprojected-ai' },
      ]);
      expect(issues).not.toContainEqual(expect.objectContaining({ code: 'secret-conflicting-target-names' }));
    }
  });

  // SPEC-C1 C1-4
  it('shares a projected allowed name across different targets and reports one reuse warning', () => {
    const result = deriveSecretNames([
      { id: 'first-account', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Account password' }, secret: { allowedName: 'shared.password' } },
      { id: 'second-account', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Payment password' }, secret: { allowedName: 'shared.password' } },
    ] as never, { projected: ['shared.password'], allowlist: [] } as never);

    expect(result.steps).toMatchObject([
      { secretRef: '{{secrets.shared.password}}' },
      { secretRef: '{{secrets.shared.password}}' },
    ]);
    expect(result.warnings).toEqual([
      { kind: 'secret-name-reused-across-targets', name: 'shared.password', stepIds: ['first-account', 'second-account'] },
    ]);
  });

  // SPEC-C1 C1-4
  it('shares a target-slug name for equal canonical targets without a warning', () => {
    const target = { strategy: 'accessibility', role: 'textbox', name: 'Password' };
    const result = deriveSecretNames([
      { id: 'first-password', kind: 'action', action: 'fill-secret', target },
      { id: 'second-password', kind: 'action', action: 'fill-secret', target },
    ] as never, { projected: [], allowlist: [] } as never);

    expect(result.steps).toMatchObject([
      { secretRef: '{{secrets.password}}' },
      { secretRef: '{{secrets.password}}' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  // SPEC-C1 C1-4
  it('suffixes a colliding target slug for a different canonical target without a warning', () => {
    const result = deriveSecretNames([
      { id: 'first-card', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card #1' } },
      { id: 'second-card', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card! 1' } },
    ] as never, { projected: [], allowlist: [] } as never);

    expect(result.steps).toMatchObject([
      { secretRef: '{{secrets.card_1}}' },
      { secretRef: '{{secrets.card_1_2}}' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  // SPEC-C1 C1-4
  it('allocates distinct consecutive suffixes for three simultaneous collisions', () => {
    const result = deriveSecretNames([
      { id: 'base', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card #1' } },
      { id: 'second', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card! 1' } },
      { id: 'third', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card? 1' } },
      { id: 'fourth', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Card@ 1' } },
    ] as never, { projected: [], allowlist: [] } as never);

    expect(result.uses.map(({ name }) => name)).toEqual(['card_1', 'card_1_2', 'card_1_3', 'card_1_4']);
    expect(new Set(result.uses.map(({ name }) => name)).size).toBe(4);
  });

  // SPEC-C1 C1-4
  it('reserves a later explicit name before an earlier derived collision', () => {
    const result = deriveSecretNames([
      { id: 'derived-first', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' } },
      { id: 'explicit-later', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Account password' }, secret: { allowedName: 'password' } },
    ] as never, { projected: ['password'], allowlist: [] } as never);

    expect(result.steps).toMatchObject([
      { secretRef: '{{secrets.password_2}}' },
      { secretRef: '{{secrets.password}}' },
    ]);
    expect(result.uses).toMatchObject([
      { name: 'password_2', selectionSource: 'target-slug' },
      { name: 'password', selectionSource: 'allowed-name' },
    ]);
  });

  // SPEC-C1 C1-4
  it('lets a non-reserved derived use share a later explicit reservation for its canonical target', () => {
    const result = deriveSecretNames([
      { id: 'first-name', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Account' } },
      { id: 'other-target', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' } },
      { id: 'conflicting-later', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Account' }, secret: { allowedName: 'password' } },
    ] as never, { projected: ['password'], allowlist: [] } as never);

    expect(result.steps).toMatchObject([
      { secretRef: '{{secrets.password}}' },
      { secretRef: '{{secrets.password_2}}' },
      { secretRef: '{{secrets.password}}' },
    ]);
    expect(result.uses).toMatchObject([
      { name: 'password', selectionSource: 'allowed-name' },
      { name: 'password_2', selectionSource: 'target-slug' },
      { name: 'password', selectionSource: 'allowed-name' },
    ]);
  });

  // SPEC-C1 C1-4
  it('rejects an explicit and allowlist-promoted derived name for one canonical target', () => {
    const derive = () => deriveSecretNames([
      { id: 'explicit', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Account' }, secret: { allowedName: 'account.secret' } },
      { id: 'promoted', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Account' } },
    ] as never, { projected: ['account.secret'], allowlist: ['account'] } as never);

    expect(derive).toThrow(AiResponseInvalidError);
    try {
      derive();
    } catch (error) {
      expect(error).toBeInstanceOf(AiResponseInvalidError);
      expect((error as AiResponseInvalidError).details).toMatchObject({
        issues: [{ code: 'secret-conflicting-target-names', path: 'steps[1].secret', stepId: 'promoted' }],
      });
    }
  });

  // SPEC-C1 C1-4
  it('sorts independently constructed reuse warnings by the documented UTF-16 key', () => {
    const result = deriveSecretNames([
      { id: 'z-first', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Z first' }, secret: { allowedName: 'z-name' } },
      { id: 'z-second', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Z second' }, secret: { allowedName: 'z-name' } },
      { id: 'a-first', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'A first' }, secret: { allowedName: 'a-name' } },
      { id: 'a-second', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'A second' }, secret: { allowedName: 'a-name' } },
    ] as never, { projected: ['z-name', 'a-name'], allowlist: [] } as never);

    expect(result.warnings).toEqual([
      { kind: 'secret-name-reused-across-targets', name: 'a-name', stepIds: ['a-first', 'a-second'] },
      { kind: 'secret-name-reused-across-targets', name: 'z-name', stepIds: ['z-first', 'z-second'] },
    ]);
  });

  // SPEC-C1 C1-4
  it('sorts every hand-built warning variant by its documented UTF-16 key', () => {
    const warnings: SecretWarning[] = [
      { kind: 'secret-target-changed', name: 'z-name', stepId: 'a-step', previousTarget: { strategy: 'accessibility', role: 'textbox', name: 'Before' }, target: { strategy: 'accessibility', role: 'textbox', name: 'After' } },
      { kind: 'secret-name-reused-across-targets', name: 'same-name', stepIds: ['z-step'] },
      { kind: 'allowed-names-truncated', kept: 1, dropped: 2 },
      { kind: 'secret-target-changed', name: 'a-name', stepId: 'z-step', previousTarget: { strategy: 'accessibility', role: 'textbox', name: 'Before' }, target: { strategy: 'accessibility', role: 'textbox', name: 'After' } },
      { kind: 'secret-name-reused-across-targets', name: 'same-name', stepIds: ['a-step'] },
    ];

    expect([...warnings].sort(compareSecretWarnings)).toEqual([
      warnings[2], warnings[4], warnings[1], warnings[3], warnings[0],
    ]);
  });
});

describe('deriveStage2ReplacementSecretNames', () => {
  it('reserves retained fill and AI references even when their names differ from the replacement slug and ordinal', () => {
    const output = deriveStage2ReplacementSecretNames({
      plan: STAGE2_PLAN,
      replacementIndex: 1,
      attributedReplacement: { id: 'replace-me', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Retained fill' } } as never,
      projected: [],
      allowlist: '*',
    });

    expect(output.candidate.steps).toMatchObject([
      { secretRef: '{{secrets.retained.fill}}' },
      { secretRef: '{{secrets.retained_fill}}' },
      { secrets: [{ ref: '{{secrets.retained.ai}}' }] },
    ]);
    expect(output.candidate.steps[0]).toBe(STAGE2_PLAN.steps[0]);
    expect(output.candidate.steps[2]).toBe(STAGE2_PLAN.steps[2]);
  });

  it.each([
    ['before', 1],
    ['after', 0],
  ] as const)('suffixes a replacement when a retained owner is %s its index on a different target', (position, replacementIndex) => {
    const retained = {
      id: `retained-${position}`, kind: 'action', action: 'fill-secret',
      target: { strategy: 'accessibility', role: 'textbox', name: 'Existing credential' },
      secretRef: '{{secrets.password}}',
    };
    const replacement = { id: 'replace-me', kind: 'assert', check: 'text-visible', text: 'replace' };
    const steps = position === 'before' ? [retained, replacement] : [replacement, retained];
    const plan = PlanDocument.parse({ ...STAGE2_PLAN, steps });
    const output = deriveStage2ReplacementSecretNames({
      plan,
      replacementIndex,
      attributedReplacement: { id: plan.steps[replacementIndex]!.id, kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' } } as never,
      projected: [],
      allowlist: '*',
    });
    expect(output.uses).toMatchObject([{ name: 'password_2' }]);
    const retainedIndex = position === 'before' ? 0 : 1;
    expect(output.candidate.steps[retainedIndex]).toBe(plan.steps[retainedIndex]);
    expect(output.candidate.steps[retainedIndex]).toMatchObject({ secretRef: '{{secrets.password}}' });
  });

  it('keeps wildcard projection separate from retained reservations and rejects an unprojected explicit replacement name', () => {
    expect(() => deriveStage2ReplacementSecretNames({
      plan: STAGE2_PLAN,
      replacementIndex: 1,
      attributedReplacement: { id: 'replace-me', kind: 'action', action: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Other' }, secret: { allowedName: 'not-projected' } } as never,
      projected: [],
      allowlist: '*',
    })).toThrow(AiResponseInvalidError);
  });
});

describe('normalizeAiStepSecretUses', () => {
  // SPEC-C1 C1-4
  it('deduplicates and UTF-16-sorts each AI step refs', () => {
    const result = normalizeAiStepSecretUses([
      { id: 'ai', kind: 'ai', instruction: 'x', secrets: [{ ref: '{{secrets.z}}' }, { ref: '{{secrets.a}}' }, { ref: '{{secrets.z}}' }] },
    ] as never);

    expect(result[0]).toMatchObject({ secrets: [{ ref: '{{secrets.a}}' }, { ref: '{{secrets.z}}' }] });
  });

  // SPEC-C1 C1-4
  it('omits the secrets key when an AI step has no resolved refs', () => {
    const result = normalizeAiStepSecretUses([
      { id: 'empty-ai', kind: 'ai', instruction: 'x', secrets: [] },
    ] as never);

    expect(result[0]).not.toHaveProperty('secrets');
  });

  // SPEC-C1 C1-4
  it('leaves non-AI steps and AI steps without secrets unchanged', () => {
    const steps = [
      { id: 'navigate', kind: 'action', action: 'navigate', url: 'https://example.test' },
      { id: 'ai-without-secrets', kind: 'ai', instruction: 'x' },
    ] as const;

    const result = normalizeAiStepSecretUses(steps as never);

    expect(result[0]).toBe(steps[0]);
    expect(result[1]).toBe(steps[1]);
  });
});
