import { describe, expect, it } from 'vitest';
import { type PlanDocument } from '#core/ir/schema.js';
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';
import { SecretLiteralRejectedError } from '#core/errors/secret-literal-rejected-error.js';
import { assertNoLiteralSecrets, assertSecretUsesAllowed, detectSecretLiteral, enumerateSecretUses } from '#usecases/generator-secret-policy.js';

const INPUTS_DIGEST = '0123456789abcdef'.repeat(4);
const TARGET = { strategy: 'accessibility', role: 'textbox', name: 'Password' } as const;
const FIRST_REF = '{{secrets.FIRST}}';
const SECOND_REF = '{{secrets.SECOND}}';
const THIRD_REF = '{{secrets.THIRD}}';
const WHOLE_SECRET_REFERENCE = '{{secrets.PRODUCTION_PAYMENTS_API_KEY_Q7X9M2V8R4K6T1C3Z5}}';
function plan(steps: readonly unknown[]): PlanDocument { return { schemaVersion: 3, source: { inputsDigest: INPUTS_DIGEST }, targets: { web: { baseUrl: 'https://example.test', browser: 'chromium' } }, steps: [...steps] } as unknown as PlanDocument; }
function expectLiteralSecretRejected(document: PlanDocument, rejectedLiteral: string, detector: unknown, path: string): void { let thrown: unknown; try { assertNoLiteralSecrets(document); } catch (error) { thrown = error; } expect(thrown).toBeInstanceOf(SecretLiteralRejectedError); if (thrown instanceof SecretLiteralRejectedError) { expect(thrown).toMatchObject({ details: { detector, path } }); expect(JSON.stringify(thrown.details)).not.toContain(rejectedLiteral); expect(JSON.stringify(thrown)).not.toContain(rejectedLiteral); } }

describe('enumerateSecretUses', () => {
  it('walks fill-secret actions and AI secrets in plan and array order, with useIndex only for AI uses', () => {
    expect(enumerateSecretUses(plan([{ id: 'fill-first', kind: 'action', action: 'fill-secret', target: TARGET, secretRef: FIRST_REF }, { id: 'navigate', kind: 'action', action: 'navigate', url: '/' }, { id: 'ai', kind: 'ai', instruction: 'Continue.', secrets: [{ ref: SECOND_REF }, { ref: FIRST_REF }] }, { id: 'fill-last', kind: 'action', action: 'fill-secret', target: TARGET, secretRef: THIRD_REF }]))).toEqual([{ ref: FIRST_REF, stepId: 'fill-first' }, { ref: SECOND_REF, stepId: 'ai', useIndex: 0 }, { ref: FIRST_REF, stepId: 'ai', useIndex: 1 }, { ref: THIRD_REF, stepId: 'fill-last' }]);
  });
});
describe('assertSecretUsesAllowed', () => {
  const document = () => plan([{ id: 'fill-first', kind: 'action', action: 'fill-secret', target: TARGET, secretRef: FIRST_REF }, { id: 'ai', kind: 'ai', instruction: 'Continue.', secrets: [{ ref: SECOND_REF }, { ref: FIRST_REF }] }, { id: 'fill-last', kind: 'action', action: 'fill-secret', target: TARGET, secretRef: THIRD_REF }]);
  it('accepts wildcard and explicit complete allowlists', () => { expect(() => assertSecretUsesAllowed(document(), '*', { configPath: null, cwd: '/workspace' })).not.toThrow(); expect(() => assertSecretUsesAllowed(document(), ['FIRST', 'SECOND', 'THIRD'], { configPath: null, cwd: '/workspace' })).not.toThrow(); });
  it('reports every unauthorized use in canonical order with the fixed remediation hint', () => { let thrown: unknown; try { assertSecretUsesAllowed(document(), ['SECOND'], { configPath: '/work/ambercast.config.json', cwd: '/ignored' }); } catch (error) { thrown = error; } expect(thrown).toBeInstanceOf(SecretConsentRequiredError); expect(thrown).toMatchObject({ details: { reason: 'consent-required', secrets: [{ name: 'FIRST', stepId: 'fill-first', envVar: 'AMBERCAST_SECRET_FIRST', reason: expect.any(String) }, { name: 'FIRST', stepId: 'ai', envVar: 'AMBERCAST_SECRET_FIRST', reason: expect.any(String) }, { name: 'THIRD', stepId: 'fill-last', envVar: 'AMBERCAST_SECRET_THIRD', reason: expect.any(String) }], hint: '/work/ambercast.config.json の secrets.allow に FIRST, THIRD を追加するか "*" を設定。値は AMBERCAST_SECRET_<NAME> に置く' } }); });
});

describe('detectSecretLiteral', () => {
  it.each([['English sentence', 'When I submit valid credentials, I reach the dashboard.'], ['Japanese sentence', '料金ページに表示されている無料プランと有料プランそれぞれの説明文を読み、日本語表現として不自然な箇所がないか判断する。'], ['email-shaped literal', 'astamup-df+clerk_test@example.com'], ['URL with a query string', 'https://staging.example.com/login?next=%2Fdashboard'], ['interpolation-bearing sentence', 'Fill the field with {{run.x}} before continuing the flow.'], ['low-entropy token-shaped literal', 'A'.repeat(32)]])('accepts a %s', (_description, value) => { expect(detectSecretLiteral(value)).toBeUndefined(); });
  it.each([['base64 literal', 'dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZQ=='], ['full JWT literal', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'], ['AWS-shaped literal', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'], ['length and entropy co-boundary literal', '0123456789ABCDEF'.repeat(2)]])('rejects a %s', (_description, value) => { expect(detectSecretLiteral(value)).toBe('high-entropy-token'); });
  it('keeps prefix detectors independent of token shape', () => { expect(detectSecretLiteral('sk-live secret with space')).toBe('credential-prefix-sk'); });
});
describe('assertNoLiteralSecrets', () => {
  it.each([['sk prefix', 'sk-live-secret-value', 'credential-prefix-sk'], ['GitHub token prefix', 'ghp_secret-value', 'credential-prefix-ghp'], ['AWS access key prefix', 'AKIASECRET123456789', 'credential-prefix-aws-access-key']] as const)('continues to reject a nested %s without retaining its literal value', (_description, value, detector) => { const document = plan([]); document.generatorMeta = { nested: { credentials: [value] } }; expectLiteralSecretRejected(document, value, detector, 'generatorMeta.nested.credentials[0]'); });
  it('accepts a symbol-containing unconstrained generator-metadata value outside the token shape', () => { const document = plan([]); document.generatorMeta = { token: 'aB3!dE5@fG7#hI9$jK2%mN4^pQ6&rS8T' }; expect(() => assertNoLiteralSecrets(document)).not.toThrow(); });
  it('continues to exempt the usecase-computed source inputs digest by exact field path', () => { expect(() => assertNoLiteralSecrets(plan([]))).not.toThrow(); });
  it('continues to exempt a valid whole secret reference from literal-secret detection', () => { const document = plan([]); document.generatorMeta = { credential: WHOLE_SECRET_REFERENCE }; expect(() => assertNoLiteralSecrets(document)).not.toThrow(); });
  it('continues to exempt a valid whole secret reference used as an object key from literal-secret detection', () => {
    const document = plan([]);
    document.generatorMeta = { [WHOLE_SECRET_REFERENCE]: { origin: 'prompt grant' } };

    expect(() => assertNoLiteralSecrets(document)).not.toThrow();
  });
  it('continues to reject an embedded secret-reference marker in unconstrained metadata', () => { const note = 'Use {{secrets.LOGIN_PASSWORD}} exactly as copied.'; const document = plan([]); document.generatorMeta = { note }; expectLiteralSecretRejected(document, note, 'embedded-secret-reference', 'generatorMeta.note'); });
  it('applies the high-entropy threshold only at 32 characters and 4.0 bits per character', () => {
    const belowLength = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0E';
    const atThreshold = `${belowLength}a`;
    const belowLengthDocument = plan([]);
    belowLengthDocument.generatorMeta = { belowLength };
    const lowEntropyDocument = plan([]);
    lowEntropyDocument.generatorMeta = { lowEntropy: 'a'.repeat(32) };
    const atThresholdDocument = plan([]);
    atThresholdDocument.generatorMeta = { atThreshold };

    expect(() => assertNoLiteralSecrets(belowLengthDocument)).not.toThrow();
    expect(() => assertNoLiteralSecrets(lowEntropyDocument)).not.toThrow();
    expectLiteralSecretRejected(
      atThresholdDocument,
      atThreshold,
      'high-entropy-token',
      'generatorMeta.atThreshold',
    );
  });
  it('continues to traverse schema-defined plan fields as well as unconstrained generator metadata', () => { const literal = 'sk-live-secret-in-fill-value'; expectLiteralSecretRejected(plan([{ id: 'fill-token', kind: 'action', action: 'fill', target: { strategy: 'accessibility', role: 'textbox', name: 'API token' }, value: literal }]), literal, 'credential-prefix-sk', 'steps[0].value'); });
  it('reports the deterministic first violation in lexical object-key and array-index order', () => { const first = 'ghp_first-secret-value'; const document = plan([]); document.generatorMeta = { zeta: 'sk-later-secret-value', alpha: [first, 'AKIASECONDSECRET123'] }; expectLiteralSecretRejected(document, first, 'credential-prefix-ghp', 'generatorMeta.alpha[0]'); });
  it('detects a secret-like metadata key without exposing that key in diagnostics', () => { const rejectedKey = 'sk-live-secret-key'; const document = plan([]); document.generatorMeta = { [rejectedKey]: 'ordinary metadata' }; expectLiteralSecretRejected(document, rejectedKey, 'credential-prefix-sk', 'generatorMeta[redacted-key]'); });
  it('exempts a token-shaped high-entropy value at steps[i].url', () => { const token = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0Ea'; const document = plan([]); document.steps = [{ id: 'navigate', kind: 'action', action: 'navigate', url: token }] as PlanDocument['steps']; expect(() => assertNoLiteralSecrets(document)).not.toThrow(); });
  it('exempts a token-shaped high-entropy value at steps[i].pattern', () => { const token = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0Ea'; const document = plan([]); document.steps = [{ id: 'url-matches', kind: 'assert', check: 'url-matches', pattern: token }] as PlanDocument['steps']; expect(() => assertNoLiteralSecrets(document)).not.toThrow(); });
  it('does not exempt a token-shaped high-entropy value at a nested path with the same rendered target path', () => {
    const token = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0Ea';
    const document = {
      targets: { staging: { web: { baseUrl: token } } },
    } as unknown as PlanDocument;

    expectLiteralSecretRejected(document, token, 'high-entropy-token', 'targets.staging.web.baseUrl');
  });
  it('does not exempt a token-shaped high-entropy value at a non-exempt path', () => { const token = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0Ea'; expectLiteralSecretRejected(plan([{ id: 'fill-token', kind: 'action', action: 'fill', target: TARGET, value: token }]), token, 'high-entropy-token', 'steps[0].value'); });
  it('continues to reject a prefix-detected value at an exempt path', () => { const literal = 'sk-live-secret-value'; const document = plan([]); document.steps = [{ id: 'navigate', kind: 'action', action: 'navigate', url: literal }] as PlanDocument['steps']; expectLiteralSecretRejected(document, literal, 'credential-prefix-sk', 'steps[0].url'); });
  it('does not exempt a token-shaped high-entropy value under an array root', () => { const token = 'Zx9Qp2Lm7Vt4Rk8Ns3Wc6Yb1Hd5Jf0Ea'; expectLiteralSecretRejected([token] as unknown as PlanDocument, token, 'high-entropy-token', '[0]'); });
  it('rejects an embedded secret-reference marker in an object key without exposing the key', () => { const rejectedKey = 'note {{secrets.X}}'; const document = plan([]); document.generatorMeta = { [rejectedKey]: 'value' }; expectLiteralSecretRejected(document, rejectedKey, 'embedded-secret-reference', 'generatorMeta[redacted-key]'); });
});
