import { describe, expect, it } from 'vitest';

import { renderToolResult } from '#adapters/mcp/render.js';

type Tool = Parameters<typeof renderToolResult>[0];

const errorMatrix: readonly [Tool, number, boolean][] = [
  ['generate', 0, false], ['generate', 1, false], ['generate', 2, true],
  ['generate', 3, true], ['generate', 4, false], ['generate', 5, false],
  ['run', 0, false], ['run', 1, false], ['run', 2, true],
  ['run', 3, true], ['run', 4, true], ['run', 5, false],
  ['check', 0, false], ['check', 1, false], ['check', 2, true],
  ['check', 3, true], ['check', 4, false], ['check', 5, false],
  ['heal', 0, false], ['heal', 1, false], ['heal', 2, true],
  ['heal', 3, true], ['heal', 4, true], ['heal', 5, false],
];

describe('mcp/render TEST-B6', () => {
  it.each(errorMatrix)('%s exit %i maps isError to %s', (tool, exitCode, isError) => {
    const envelope = { command: tool, errors: [] };

    const rendered = renderToolResult(tool, { exitCode, envelope });

    expect(rendered.isError).toBe(isError);
    expect(rendered.structuredContent).toEqual(envelope);
    expect(rendered._meta.exitCode).toBe(exitCode);
  });

  it('renders exactly one text item with exit code followed by serialized envelope', () => {
    const envelope = { command: 'run', summary: { passed: 1, failed: 0 } };

    const rendered = renderToolResult('run', { exitCode: 0, envelope });

    expect(rendered.content).toEqual([{
      type: 'text',
      text: `exitCode: 0\n${JSON.stringify(envelope)}`,
    }]);
    expect(rendered.structuredContent).toEqual(envelope);
    expect(rendered._meta.exitCode).toBe(0);
  });

  it('places a supplied apply token on the second line, including an empty token', () => {
    const envelope = { command: 'heal', results: [] };

    for (const token of ['later-apply', '']) {
      const rendered = renderToolResult('heal', { exitCode: 2, envelope }, token);

      expect(rendered.content).toEqual([{
        type: 'text',
        text: `exitCode: 2\napplyToken: ${token}\n${JSON.stringify(envelope)}`,
      }]);
      expect(rendered.structuredContent).toEqual(envelope);
      expect(rendered._meta.exitCode).toBe(2);
    }
  });
});
