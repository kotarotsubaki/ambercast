import { describe, expect, it } from 'vitest';
import {
  applyAppend,
  applyBlockReplace,
  classifyAgents,
  classifyConfig,
  classifyGitignore,
  classifySample,
  decodePreservingBom,
} from '../../../../src/core/init/plan.js';
import {
  AGENTS_BLOCK,
  CONFIG_TEMPLATE,
  GITIGNORE_APPEND_UNIT,
  SAMPLE_TEMPLATE,
} from '../../../../src/core/init/templates.js';

const beginMarker = '<!-- ambercast:begin -->';
const endMarker = '<!-- ambercast:end -->';
const crlf = (text: string): string => text.replaceAll('\n', '\r\n');

describe('decodePreservingBom', () => {
  it('preserves a complete UTF-8 BOM as a leading character', () => {
    expect(decodePreservingBom(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('\uFEFFA');
  });

  it('decodes BOM-free UTF-8 without adding a BOM', () => {
    expect(decodePreservingBom(Uint8Array.from([0x41, 0xc3, 0xa9]))).toBe('Aé');
  });

  it('decodes empty bytes to an empty string', () => {
    expect(decodePreservingBom(new Uint8Array(0))).toBe('');
  });

  it('replaces an incomplete BOM sequence before subsequent ASCII', () => {
    expect(decodePreservingBom(Uint8Array.from([0xef, 0xbb, 0x41]))).toBe('�A');
  });

  it('replaces a lone UTF-8 continuation byte', () => {
    expect(decodePreservingBom(Uint8Array.from([0xbf]))).toBe('�');
  });
});

describe('init plan classification', () => {
  describe('classifyConfig', () => {
    it('creates an absent config and skips only the byte-identical literal', () => {
      expect(classifyConfig(null, false)).toStrictEqual({
        kind: 'action', action: 'create', nextText: CONFIG_TEMPLATE,
      });
      expect(classifyConfig(CONFIG_TEMPLATE, false)).toStrictEqual({
        kind: 'action', action: 'skipped', nextText: null,
      });
    });

    it('rejects a differing config without force and replaces it with force', () => {
      expect(classifyConfig('{"testDir":"other"}\n', false)).toStrictEqual({
        kind: 'rejected', reason: 'config-conflict',
      });
      expect(classifyConfig('{"testDir":"other"}\n', true)).toStrictEqual({
        kind: 'action', action: 'replace', nextText: CONFIG_TEMPLATE,
      });
    });

    it('treats BOM and CRLF variants as different bytes and normalizes them only with force', () => {
      for (const current of [`\uFEFF${CONFIG_TEMPLATE}`, crlf(CONFIG_TEMPLATE)]) {
        expect(classifyConfig(current, false)).toStrictEqual({
          kind: 'rejected', reason: 'config-conflict',
        });
        expect(classifyConfig(current, true)).toStrictEqual({
          kind: 'action', action: 'replace', nextText: CONFIG_TEMPLATE,
        });
      }
    });
  });

  describe('classifySample', () => {
    it('creates only an absent sample and preserves every existing sample', () => {
      expect(classifySample(null)).toStrictEqual({
        kind: 'action', action: 'create', nextText: SAMPLE_TEMPLATE,
      });
      for (const current of ['', '# A custom prompt\n', SAMPLE_TEMPLATE]) {
        expect(classifySample(current)).toStrictEqual({
          kind: 'action', action: 'skipped', nextText: null,
        });
      }
    });
  });

  describe('classifyGitignore', () => {
    it('creates an absent file with the canonical append unit', () => {
      expect(classifyGitignore(null)).toStrictEqual({
        kind: 'action', action: 'create', nextText: GITIGNORE_APPEND_UNIT,
      });
    });

    it('skips a complete runs-directory line with LF, CRLF, or no final newline', () => {
      for (const current of [
        'node_modules/\ntests/ambercast/.runs/\n',
        'node_modules/\r\ntests/ambercast/.runs/\r\n',
        'node_modules/\ntests/ambercast/.runs/',
      ]) {
        expect(classifyGitignore(current)).toStrictEqual({
          kind: 'action', action: 'skipped', nextText: null,
        });
      }
    });

    it('ignores a leading BOM while looking for the complete runs-directory line', () => {
      expect(classifyGitignore('\uFEFFtests/ambercast/.runs/\n')).toStrictEqual({
        kind: 'action', action: 'skipped', nextText: null,
      });
    });

    it('does not treat whitespace-padded lines as the managed entry', () => {
      expect(classifyGitignore('  tests/ambercast/.runs/  \n')).toStrictEqual({
        kind: 'action',
        action: 'append',
        nextText: `  tests/ambercast/.runs/  \n${GITIGNORE_APPEND_UNIT}`,
      });
    });

    it.each([
      ['node_modules/\n', `node_modules/\n${GITIGNORE_APPEND_UNIT}`],
      ['node_modules/', `node_modules/\n${GITIGNORE_APPEND_UNIT}`],
      ['tests/ambercast/.runs', `tests/ambercast/.runs\n${GITIGNORE_APPEND_UNIT}`],
      ['', GITIGNORE_APPEND_UNIT],
      ['\uFEFF', `\uFEFF${GITIGNORE_APPEND_UNIT}`],
      ['\uFEFFnode_modules/\r\n', `\uFEFFnode_modules/\r\n${crlf(GITIGNORE_APPEND_UNIT)}`],
    ])('appends the exact projected unit for %j', (current, nextText) => {
      expect(classifyGitignore(current)).toStrictEqual({
        kind: 'action', action: 'append', nextText,
      });
    });
  });

  describe('classifyAgents', () => {
    it('creates an absent AGENTS.md and appends when there are no marker lines', () => {
      expect(classifyAgents(null)).toStrictEqual({
        kind: 'action', action: 'create', nextText: AGENTS_BLOCK,
      });
      expect(classifyAgents('existing guidance\n')).toStrictEqual({
        kind: 'action', action: 'append', nextText: `existing guidance\n\n${AGENTS_BLOCK}`,
      });
      expect(classifyAgents(`text ${beginMarker}\n`)).toStrictEqual({
        kind: 'action', action: 'append', nextText: `text ${beginMarker}\n\n${AGENTS_BLOCK}`,
      });
    });

    it('treats exact marker lines inside code fences as managed markers', () => {
      const current = `\`\`\`md\n${beginMarker}\n\`\`\`\n`;

      expect(classifyAgents(current)).toStrictEqual({
        kind: 'rejected', reason: 'agents-malformed-markers',
      });
    });

    it('preserves a BOM-only AGENTS.md while appending the exact block', () => {
      expect(classifyAgents('\uFEFF')).toStrictEqual({
        kind: 'action', action: 'append', nextText: `\uFEFF${AGENTS_BLOCK}`,
      });
    });

    it('recognizes whitespace-only padding around marker lines', () => {
      expect(classifyAgents(`  ${beginMarker}  \ncontent\n  ${endMarker}  \n`)).toStrictEqual({
        kind: 'action', action: 'replace',
        nextText: AGENTS_BLOCK,
      });
    });

    it('skips a correct EOL-projected block and replaces changed correct pairs', () => {
      expect(classifyAgents(AGENTS_BLOCK)).toStrictEqual({
        kind: 'action', action: 'skipped', nextText: null,
      });
      expect(classifyAgents(crlf(AGENTS_BLOCK))).toStrictEqual({
        kind: 'action', action: 'skipped', nextText: null,
      });
      expect(classifyAgents(`${beginMarker}\nold guidance\n${endMarker}\n`)).toStrictEqual({
        kind: 'action', action: 'replace', nextText: AGENTS_BLOCK,
      });
      expect(classifyAgents(`${beginMarker}\r\nold guidance\r\n${endMarker}\r\n`)).toStrictEqual({
        kind: 'action', action: 'replace', nextText: crlf(AGENTS_BLOCK),
      });
    });

    it('recognizes a BOM before a valid marker pair and preserves it when replacing', () => {
      expect(classifyAgents(`\uFEFF${AGENTS_BLOCK}`)).toStrictEqual({
        kind: 'action', action: 'skipped', nextText: null,
      });
      expect(classifyAgents(`\uFEFF${beginMarker}\nold guidance\n${endMarker}\n`)).toStrictEqual({
        kind: 'action', action: 'replace', nextText: `\uFEFF${AGENTS_BLOCK}`,
      });
    });

    it('rejects every malformed marker arrangement', () => {
      for (const current of [
        `${beginMarker}\n`,
        `${endMarker}\n`,
        `${endMarker}\n${beginMarker}\n`,
        `${beginMarker}\n${endMarker}\n${beginMarker}\n${endMarker}\n`,
      ]) {
        expect(classifyAgents(current)).toStrictEqual({
          kind: 'rejected', reason: 'agents-malformed-markers',
        });
      }
    });
  });
});

describe('init plan text transformations', () => {
  describe('applyAppend', () => {
    it('applies the gitignore trailing-newline rule with LF and CRLF', () => {
      expect(applyAppend('node_modules/\n', GITIGNORE_APPEND_UNIT, 'trailing-newline'))
        .toBe(`node_modules/\n${GITIGNORE_APPEND_UNIT}`);
      expect(applyAppend('node_modules/', GITIGNORE_APPEND_UNIT, 'trailing-newline'))
        .toBe(`node_modules/\n${GITIGNORE_APPEND_UNIT}`);
      expect(applyAppend('node_modules/\r\n', GITIGNORE_APPEND_UNIT, 'trailing-newline'))
        .toBe(`node_modules/\r\n${crlf(GITIGNORE_APPEND_UNIT)}`);
      expect(applyAppend('', GITIGNORE_APPEND_UNIT, 'trailing-newline')).toBe(GITIGNORE_APPEND_UNIT);
    });

    it('normalizes the AGENTS.md boundary to exactly one empty line', () => {
      expect(applyAppend('x\n', AGENTS_BLOCK, 'blank-line-separator')).toBe(`x\n\n${AGENTS_BLOCK}`);
      expect(applyAppend('x', AGENTS_BLOCK, 'blank-line-separator')).toBe(`x\n\n${AGENTS_BLOCK}`);
      expect(applyAppend('x\n\n', AGENTS_BLOCK, 'blank-line-separator')).toBe(`x\n\n${AGENTS_BLOCK}`);
      expect(applyAppend('', AGENTS_BLOCK, 'blank-line-separator')).toBe(AGENTS_BLOCK);
      expect(applyAppend('\uFEFF', AGENTS_BLOCK, 'blank-line-separator')).toBe(`\uFEFF${AGENTS_BLOCK}`);
      expect(applyAppend('x\r\n', AGENTS_BLOCK, 'blank-line-separator')).toBe(`x\r\n\r\n${crlf(AGENTS_BLOCK)}`);
    });
  });

  describe('applyBlockReplace', () => {
    it('replaces exactly the marker span while retaining surrounding text', () => {
      const current = `before\n${beginMarker}\nold\n${endMarker}\nafter\n`;
      expect(applyBlockReplace(current, AGENTS_BLOCK)).toBe(`before\n${AGENTS_BLOCK}after\n`);
    });

    it('projects replacements to CRLF and retains a leading BOM', () => {
      const current = `\uFEFFbefore\r\n${beginMarker}\r\nold\r\n${endMarker}\r\nafter\r\n`;
      expect(applyBlockReplace(current, AGENTS_BLOCK)).toBe(`\uFEFFbefore\r\n${crlf(AGENTS_BLOCK)}after\r\n`);
    });

    it('replaces an end marker without a final newline and retains the CRLF boundary', () => {
      expect(applyBlockReplace(`before\r\n${beginMarker}\r\nold\r\n${endMarker}`, AGENTS_BLOCK))
        .toBe(`before\r\n${crlf(AGENTS_BLOCK)}`);
    });
  });
});
