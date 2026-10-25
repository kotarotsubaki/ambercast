import { readFileSync } from 'node:fs';
import { ProviderFixtureValue, type ProviderFixture } from './provider-fixture.js';

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
type Provider = ProviderFixture['provider'];

/**
 * Gives every generated fixture traceable synthetic provenance and the same
 * validation boundary as recorded fixtures. Schema defaults supply empty
 * streams and immediate completion without duplicating fixture policy.
 */
function synthetic(provider: Provider, input: string, parts: Partial<ProviderFixture>): ProviderFixture {
  return ProviderFixtureValue.parse({
    provider,
    provenance: { ambercast: PACKAGE_VERSION, input, origin: 'synthetic' },
    run: { exitCode: 0 },
    ...parts,
  });
}

/**
 * Builds a successful response as a control for fault-injection tests. Claude
 * carries serialized payload JSON inside its result wrapper; Codex carries it
 * in the output file and leaves stdout empty. Undefined payloads throw TypeError
 * because they cannot supply a JSON response.
 */
export function validResponse(provider: Provider, payload: unknown): ProviderFixture {
  if (payload === undefined) throw new TypeError('validResponse: payload must not be undefined');
  const full = JSON.stringify(payload);
  return synthetic(provider, `validResponse(${provider}, ${full})`, provider === 'claude-code-cli'
    ? { stdout: JSON.stringify({ result: full }) }
    : { outputFile: full });
}

/**
 * Models an interrupted response by retaining a strict prefix of serialized
 * JSON. The default payload layer preserves Claude's wrapper, while its
 * transport layer cuts the wrapper itself; Codex supports only payload cuts.
 * The default keep is half the selected text's length, rounded down. Invalid
 * integer ranges or Codex transport cuts throw RangeError, undefined payloads
 * throw TypeError, and prefixes that remain valid JSON throw an Error rather
 * than silently producing a successful response.
 */
export function truncatedJson(provider: Provider, payload: unknown, options?: { keep?: number; layer?: 'payload' | 'transport' }): ProviderFixture {
  if (payload === undefined) throw new TypeError('truncatedJson: payload must not be undefined');
  const layer = options?.layer ?? 'payload';
  if (provider === 'codex-cli' && layer === 'transport') throw new RangeError('truncatedJson: transport layer is claude-code-cli only');
  const full = JSON.stringify(payload);
  const target = layer === 'transport' ? JSON.stringify({ result: full }) : full;
  const keep = options?.keep ?? Math.floor(target.length / 2);
  if (!Number.isInteger(keep) || keep < 1 || keep >= target.length) {
    throw new RangeError('truncatedJson: keep must be an integer in 1..length-1');
  }
  const cut = target.slice(0, keep);
  let valid = false;
  try { JSON.parse(cut); valid = true; } catch { /* Malformed JSON is the intended fault. */ }
  if (valid) throw new Error('truncatedJson: the cut text is still valid JSON');
  return synthetic(provider, `truncatedJson(${provider}, ${full}, keep=${keep}, layer=${layer})`, provider === 'codex-cli'
    ? { outputFile: cut }
    : { stdout: layer === 'transport' ? cut : JSON.stringify({ result: cut }) });
}

/**
 * Models Claude completing successfully without a transport response. Keeping
 * stdout empty distinguishes missing output from a malformed payload wrapper.
 */
export function emptyStdoutExitZero(): ProviderFixture {
  return synthetic('claude-code-cli', 'emptyStdoutExitZero()', { stdout: '' });
}

/**
 * Models Codex completing with an existing but empty response file. The explicit
 * outputFile key keeps this failure distinct from a file that was never written.
 */
export function emptyOutputFile(): ProviderFixture {
  return synthetic('codex-cli', 'emptyOutputFile()', { outputFile: '' });
}

/**
 * Models a provider process failure independently of response parsing. Exit
 * code defaults to 1 and stderr to 'provider failed'; explicit empty stderr is
 * retained. Codes outside the integer range 1..255 throw RangeError so this
 * builder cannot accidentally describe a successful process.
 */
export function nonZeroExit(provider: Provider, options?: { exitCode?: number; stderr?: string }): ProviderFixture {
  const exitCode = options?.exitCode ?? 1;
  const stderr = options?.stderr ?? 'provider failed';
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
    throw new RangeError('nonZeroExit: exitCode must be an integer in 1..255');
  }
  return synthetic(provider, `nonZeroExit(${provider}, exitCode=${exitCode}, stderr=${JSON.stringify(stderr)})`, { run: { exitCode }, stderr });
}

/**
 * Models a provider that waits for cancellation without producing observable
 * output. The hang outcome leaves timeout and resource cleanup to the replay
 * runner rather than embedding timing behavior in the fixture builder.
 */
export function hangUntilTimeout(provider: Provider): ProviderFixture {
  return synthetic(provider, `hangUntilTimeout(${provider})`, { run: { hang: true } });
}
