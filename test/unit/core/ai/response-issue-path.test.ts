import { describe, expect, it } from 'vitest';
import {
  REDACTED_ISSUE_PATH_SEGMENT,
  redactDynamicPathSegments,
} from '#core/ai/response-issue-path.js';

describe('redactDynamicPathSegments', () => {
  it('preserves a path that never enters a dynamic subtree', () => {
    expect(redactDynamicPathSegments(
      { steps: [{ id: 'step-a' }] },
      ['steps', 0, 'id'],
    )).toEqual(['steps', 0, 'id']);
  });

  it('redacts every object key below generatorMeta while retaining true array indices', () => {
    expect(redactDynamicPathSegments(
      { generatorMeta: { '123': [{ nested: 'value' }] } },
      ['generatorMeta', '123', 0, 'nested'],
    )).toEqual(['generatorMeta', REDACTED_ISSUE_PATH_SEGMENT, 0, REDACTED_ISSUE_PATH_SEGMENT]);
  });

  it('converts an AJV pointer segment named "0" to a numeric index only when the parsed node is an array', () => {
    expect(redactDynamicPathSegments(
      { values: ['wrong'] },
      ['values', '0'],
    )).toEqual(['values', 0]);
  });

  it('redacts a symbol before considering an array index', () => {
    expect(redactDynamicPathSegments(
      { values: ['wrong'] },
      ['values', Symbol('untrusted')],
    )).toEqual(['values', REDACTED_ISSUE_PATH_SEGMENT]);
  });

  it('redacts object keys inside ambiguity and assertion JsonValue subtrees', () => {
    expect(redactDynamicPathSegments(
      { ambiguities: [{ privateKey: true }], steps: [{ verificationIntent: [{ assertion: { secret: true } }] }] },
      ['ambiguities', 0, 'privateKey'],
    )).toEqual(['ambiguities', 0, REDACTED_ISSUE_PATH_SEGMENT]);
    expect(redactDynamicPathSegments(
      { ambiguities: [], steps: [{ verificationIntent: [{ assertion: { secret: true } }] }] },
      ['steps', 0, 'verificationIntent', 0, 'assertion', 'secret'],
    )).toEqual(['steps', 0, 'verificationIntent', 0, 'assertion', REDACTED_ISSUE_PATH_SEGMENT]);
  });

  it('redacts every string segment below targets, including TargetDefinition fields', () => {
    const value = { targets: { app: { baseUrl: 'https://example.test', secretSinkOrigins: { token: ['https://sink.test'] } } } };
    expect(redactDynamicPathSegments(value, ['targets', 'app', 'baseUrl']))
      .toEqual(['targets', REDACTED_ISSUE_PATH_SEGMENT, REDACTED_ISSUE_PATH_SEGMENT]);
    expect(redactDynamicPathSegments(value, ['targets', 'app', 'secretSinkOrigins', 'token', 0]))
      .toEqual(['targets', REDACTED_ISSUE_PATH_SEGMENT, REDACTED_ISSUE_PATH_SEGMENT, REDACTED_ISSUE_PATH_SEGMENT, 0]);
  });

  it('starts and keeps redaction at secretSinkOrigins itself', () => {
    // In a real PlanDocument, secretSinkOrigins is reachable only below the
    // dynamic targets record. This isolated traversal input proves that the
    // nested root independently starts the same irreversible redaction state.
    expect(redactDynamicPathSegments(
      { secretSinkOrigins: { '{{secrets.TOKEN}}': ['https://sink.test'] } },
      ['secretSinkOrigins', '{{secrets.TOKEN}}', 0],
    )).toEqual(['secretSinkOrigins', REDACTED_ISSUE_PATH_SEGMENT, 0]);
  });
});
