// Both structural checks and prose rules share one mdast interpretation so
// syntax that merely resembles a heading or separator cannot create a finding.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown } from 'mdast-util-mdx';

/**
 * @typedef {Object} Violation
 * @property {'prose'} check
 * @property {string} locale
 * @property {string} page
 * @property {number|null} line
 * @property {string} rule
 * @property {'error'|'warning'} severity
 * @property {string} expected
 * @property {string} actual
 */

/**
 * @typedef {Object} TextBlock
 * @property {Array<{ line: number, text: string }>} segments
 * @property {string} joinedText
 * @property {Array<{ offset: number, line: number }>} lineMap
 */

/**
 * Returns the body and the line offset needed to report positions in the original file.
 * Without leading frontmatter, the body is the input itself and the offset is zero.
 * Adding the offset to any 1-based body line must yield that content's original line.
 *
 * @remarks The existing frontmatter parser also validates title and status, which
 * prose lint must not judge, and loses the stripped prefix needed for this mapping.
 * @param {string} markdown Complete Markdown or MDX source.
 * @returns {{ body: string, frontmatterLineOffset: number }} Body and original-line offset.
 */
export function stripFrontmatterOffset(markdown) {
  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
  const match = markdown.match(frontmatterRegex);
  if (match) {
    const matched = match[0];
    const frontmatterLineOffset = (matched.match(/\n/g) || []).length;
    const body = markdown.slice(matched.length);
    return { body, frontmatterLineOffset };
  }
  return { body: markdown, frontmatterLineOffset: 0 };
}

/**
 * Parses a frontmatter-free body into the tree shared by extraction and structural rules.
 *
 * @remarks GFM is always enabled so tables, autolinks, and strikethrough receive
 * their proper node types under SPEC-3. MDX grammar is conditional: applying it to
 * plain Markdown could reinterpret valid CommonMark that resembles JSX. This uses
 * the already hoisted mdast-util-from-markdown, micromark-extension-gfm,
 * mdast-util-gfm, micromark-extension-mdxjs, and mdast-util-mdx packages.
 * SPEC-2 and SPEC-8 do not classify parser exceptions.
 * @param {string} body Source after frontmatter removal.
 * @param {{ isMdx: boolean }} options Whether MDX grammar applies.
 * @returns {import('mdast').Root} Parsed document tree.
 */
export function parseProseTree(body, { isMdx }) {
  const extensions = isMdx ? [gfm(), mdxjs()] : [gfm()];
  const mdastExtensions = isMdx ? [gfmFromMarkdown(), mdxFromMarkdown()] : [gfmFromMarkdown()];
  return fromMarkdown(body, { extensions, mdastExtensions });
}

/**
 * Extracts SPEC-3 prose blocks and the count of Starlight asides.
 * Paragraphs inside list items remain separate paragraphs. Headings contribute to
 * term checks, but not sentence or page-length counts.
 *
 * @remarks This is a strict node policy, not an everything-except-code traversal:
 * frontmatter, code, inlineCode, html, mdxjsEsm, mdxFlowExpression,
 * mdxTextExpression, table, image (including alt), and definition contribute no
 * prose. Paragraph, listItem, blockquote, and heading text is retained; link and
 * mdxJsxTextElement children contribute text, and mdxJsxFlowElement children are
 * walked structurally. Otherwise excluded content such as image alt would leak in.
 * Starlight asides are not directive nodes: this project has neither remark-directive
 * nor mdast-util-directive. The hoisted parser may represent an aside as one
 * paragraph with mixed inline children or as sibling paragraphs around blank lines.
 * Recognized aside bodies are reconstructed from source lines, parsed again with
 * parseProseTree, and walked by this same extractor.
 * Per-source-line segments support one banned-term finding per line and term. Their
 * joinedText and offset-to-original-line lineMap also identify where a sentence
 * starts across soft wraps. A flat string cannot provide both attributions. The
 * unstripped originalLines array is the single source of truth for every reported
 * line; callers supply it alongside tree positions and their frontmatter offset.
 * @param {import('mdast').Root} tree Body tree from parseProseTree.
 * @param {string[]} originalLines Lines from the complete original source.
 * @param {number} frontmatterLineOffset Offset from stripFrontmatterOffset.
 * @param {boolean} isMdx Whether MDX grammar applies to nested asides.
 * @returns {{ textBlocks: TextBlock[], calloutCount: number }} Blocks and aside count.
 */
export function extractTextBlocks(tree, originalLines, frontmatterLineOffset, isMdx = false) {
  const textBlocks = [];
  let calloutCount = 0;

  const excludedNodeTypes = new Set([
    'code', 'inlineCode', 'html', 'mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression',
    'table', 'image', 'definition'
  ]);

  function findAsideRunEnd(children, startIndex) {
    const first = children[startIndex];
    const firstChild = first.children?.[0];
    if (first.type !== 'paragraph' || firstChild?.type !== 'text' ||
        !/^:::[a-z][a-z-]*(?:\[[^\]]*\])?$/i.test(firstChild.value.split('\n')[0])) {
      return -1;
    }

    for (let i = startIndex; i < children.length; i++) {
      const node = children[i];
      if (node.type !== 'paragraph') return -1;
      const lastChild = node.children?.at(-1);
      if (lastChild?.type === 'text' && lastChild.value.split('\n').at(-1) === ':::') {
        return i;
      }
    }
    return -1;
  }

  function handleAside(children, startIndex, endIndex, lineOffset) {
    calloutCount++;
    const openerLine = children[startIndex].position.start.line + lineOffset;
    const closerLine = children[endIndex].position.end.line + lineOffset;
    const innerSource = originalLines.slice(openerLine, closerLine - 1).join('\n');
    const innerTree = parseProseTree(innerSource, { isMdx });
    walkChildren(innerTree.children, openerLine);
  }

  function walkChildren(children, lineOffset) {
    let i = 0;
    while (i < children.length) {
      const node = children[i];
      if (node.type === 'paragraph') {
        const asideEnd = findAsideRunEnd(children, i);
        if (asideEnd !== -1) {
          handleAside(children, i, asideEnd, lineOffset);
          i = asideEnd + 1;
          continue;
        }
      }
      walk(node, lineOffset);
      i++;
    }
  }

  function walk(node, lineOffset) {
    if (excludedNodeTypes.has(node.type)) {
      return;
    }

    // Sibling runs are checked before ordinary paragraphs reach this branch.
    if (node.type === 'paragraph') {
      const block = buildTextBlockFromNode(node, originalLines, lineOffset);
      if (block) {
        textBlocks.push(block);
      }
      return;
    }

    if (node.type === 'listItem') {
      if (node.children) {
        walkChildren(node.children, lineOffset);
      }
      return;
    }

    if (node.type === 'blockquote') {
      if (node.children) {
        walkChildren(node.children, lineOffset);
      }
      return;
    }

    if (node.type === 'heading') {
      const block = buildTextBlockFromNode(node, originalLines, lineOffset);
      if (block) {
        block.nodeType = 'heading';
        textBlocks.push(block);
      }
      return;
    }

    if (node.type === 'mdxJsxFlowElement') {
      if (node.children) {
        walkChildren(node.children, lineOffset);
      }
      return;
    }

    if (node.children) {
      walkChildren(node.children, lineOffset);
      return;
    }
  }

  function buildTextBlockFromNode(node, originalLines, lineOffset) {
    if (!node.children) return null;

    const segments = [];
    let joinedText = '';
    const lineMap = [];

    // Soft wraps retain separate source lines so findings can name the original line.
    let currentLine = null;
    let currentSegmentText = '';
    let segmentOffset = 0;

    function addSegment() {
      if (currentSegmentText) {
        segments.push({ line: currentLine, text: currentSegmentText });
        lineMap.push({ offset: segmentOffset, line: currentLine });
        joinedText += currentSegmentText;
        currentSegmentText = '';
      }
    }

    function processChild(child) {
      if (child.type === 'text') {
        const startLine = child.position?.start?.line;
        if (startLine !== undefined) {
          const actualLine = startLine + lineOffset;
          const textValue = child.value;
          const textLines = textValue.split('\n');

          for (let i = 0; i < textLines.length; i++) {
            const textLine = textLines[i];
            const lineNum = actualLine + i;
            if (currentLine !== lineNum) {
              addSegment();
              currentLine = lineNum;
              segmentOffset = joinedText.length;
            }
            currentSegmentText += textLine;
            if (i < textLines.length - 1) {
              addSegment();
              currentSegmentText = '';
            }
          }
        }
      } else if (child.type === 'link') {
        // Link destinations are syntax, while link labels contribute prose.
        if (child.children) {
          for (const linkChild of child.children) {
            processChild(linkChild);
          }
        }
      } else if (child.type === 'mdxJsxTextElement') {
        if (child.children) {
          for (const jsxChild of child.children) {
            processChild(jsxChild);
          }
        }
      } else if (child.children) {
        for (const grandChild of child.children) {
          processChild(grandChild);
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        processChild(child);
      }
    }
    addSegment();

    return joinedText.trim() ? { segments, joinedText, lineMap } : null;
  }

  if (tree.children) {
    walkChildren(tree.children, frontmatterLineOffset);
  }

  return { textBlocks, calloutCount };
}

/**
 * Splits paragraph text while retaining each sentence's starting offset for line mapping.
 * English ends a sentence at `.`, `!`, or `?` followed by whitespace or paragraph
 * end; Japanese and Chinese use `。！？`. English abbreviations such as `e.g.` may
 * split early, an accepted SPEC-3 limitation rather than a case to silently repair.
 * @param {string} joinedText Joined paragraph text.
 * @param {string} locale `en`, `ja`, or `zh-cn`.
 * @returns {Array<{ text: string, offset: number }>} Sentences with starting offsets.
 */
export function splitSentences(joinedText, locale) {
  if (!joinedText) {
    return [{ text: '', offset: 0 }];
  }

  if (locale === 'en') {
    const sentences = [];
    let remaining = joinedText;
    let offset = 0;

    while (remaining) {
      const match = remaining.match(/[.!?](?=\s|$)/);
      if (match) {
        const matchedLen = match.index + 1;
        const sentenceWithPunct = remaining.slice(0, matchedLen);
        const sentenceText = sentenceWithPunct.trimStart();
        const sentenceOffsetInRemaining = sentenceWithPunct.length - sentenceText.length;
        const absoluteOffset = offset + sentenceOffsetInRemaining;
        sentences.push({ text: sentenceText, offset: absoluteOffset });
        remaining = remaining.slice(matchedLen);
        offset += matchedLen;
        const trailingWs = remaining.match(/^\s*/)?.[0] || '';
        remaining = remaining.slice(trailingWs.length);
        offset += trailingWs.length;
      } else {
        sentences.push({ text: remaining, offset: offset });
        break;
      }
    }

    if (sentences.length === 0) {
      sentences.push({ text: joinedText, offset: 0 });
    }

    return sentences;
  }

  // The boundary character stays attached to the preceding sentence.
  if (locale === 'ja' || locale === 'zh-cn') {
    const sentences = [];
    let remaining = joinedText;
    let offset = 0;

    while (remaining) {
      const match = remaining.match(/^[^。！？]*[。！？]/);
      if (match) {
        const sentence = match[0];
        sentences.push({ text: sentence, offset: offset });
        remaining = remaining.slice(match[0].length);
        offset += match[0].length;
      } else {
        sentences.push({ text: remaining, offset: offset });
        break;
      }
    }

    if (sentences.length === 0) {
      sentences.push({ text: joinedText, offset: 0 });
    }

    return sentences;
  }

  return [{ text: joinedText, offset: 0 }];
}
