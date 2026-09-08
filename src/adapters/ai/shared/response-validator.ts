/**
 * Defines adapter-boundary validation for raw provider text before it can
 * cross the AI port as typed data.
 */

import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsModule, { type FormatsPlugin } from 'ajv-formats';

import type { TypedJsonSchema } from '#core/ai/typed-json-schema.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { redactDynamicPathSegments } from '#core/ai/response-issue-path.js';

// Node ESM resolves this default export to a callable, while the package's
// CommonJS metadata makes TypeScript's NodeNext resolver expose its namespace.
const addFormats = addFormatsModule as unknown as FormatsPlugin;

/**
 * One report-safe, normalized provider-response validation issue.
 *
 * The closed `code` classifies malformed JSON or a schema mismatch without
 * carrying parser prose. `path` holds redacted field names and numeric array
 * indices, making it safe to place in a public report.
 */
export interface AiResponseValidationIssue {
  /**
   * Report-safe path segments derived from the parsed value so dynamic record
   * keys are redacted without changing true
   * array indices.
   */
  readonly path: readonly (string | number)[];

  /** Closed origin classification; parser prose never crosses this boundary. */
  readonly code: 'invalid-json' | 'schema-mismatch';
}

/**
 * Parses and validates a provider response against its requested schema.
 *
 * @typeParam T - The response shape associated with `schema` at this call.
 * @param raw - The unparsed text returned by the provider protocol.
 * @param schema - The JSON Schema that defines the accepted response.
 * @returns The parsed value after schema validation.
 * @throws {import('#core/errors/ai-response-invalid-error.js').AiResponseInvalidError}
 * When JSON parsing or schema validation fails.
 * @remarks
 * Validation uses an `Ajv2020` instance with `allErrors: true` and projects
 * every failure to the closed `{ code, path }` report shape. JSON parsing
 * yields `{ code: 'invalid-json', path: [] }`. Every AJV failure yields
 * `code: 'schema-mismatch'`; for `required`, its missing-property suffix is
 * appended to the JSON Pointer before conversion, with `~1` and `~0`
 * unescaped. The pre-validation parsed `value`, not the derived schema, then
 * travels with that pointer through `redactDynamicPathSegments`, preserving
 * real array indices while redacting dynamic object keys. Parser and AJV
 * messages remain internal and never become report issue fields.
 */
export function validateAiResponse<T>(raw: string, schema: TypedJsonSchema<T>): T {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new AiResponseInvalidError(
      'The AI provider returned malformed JSON.',
      { raw, issues: [{ code: 'invalid-json', path: [] }] },
      { cause: error },
    );
  }

  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validator = ajv.compile(schema);
  if (validator(value)) {
    return value as T;
  }

  const issues: readonly AiResponseValidationIssue[] = (validator.errors ?? []).map((error: ErrorObject) => {
    const missingProperty = error.keyword === 'required' && typeof error.params.missingProperty === 'string'
      ? error.params.missingProperty.replaceAll('~', '~0').replaceAll('/', '~1')
      : undefined;
    const pointer = missingProperty === undefined
      ? error.instancePath
      : `${error.instancePath}/${missingProperty}`;
    const path = pointer === ''
      ? []
      : pointer.slice(1).split('/').map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));

    return { code: 'schema-mismatch', path: redactDynamicPathSegments(value, path) };
  });

  throw new AiResponseInvalidError('The AI provider response did not satisfy its schema.', { raw, issues });
}
