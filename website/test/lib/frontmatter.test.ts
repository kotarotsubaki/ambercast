import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/lib/frontmatter.mjs';

describe('parseFrontmatter', () => {
  it('parses title, description, status, and preserves the body after the closing delimiter exactly', () => {
    const markdown = '---\ntitle: Example\ndescription: A page\nstatus: planned\n---\n\nBody\\nwith a literal backslash.\n';

    expect(parseFrontmatter(markdown)).toEqual({
      title: 'Example',
      description: 'A page',
      status: 'planned',
      body: '\nBody\\nwith a literal backslash.\n',
    });
  });

  it('defaults an absent status to available', () => {
    expect(parseFrontmatter('---\ntitle: Available\ndescription: Default status\n---\nBody')).toMatchObject({
      title: 'Available',
      description: 'Default status',
      status: 'available',
      body: 'Body',
    });
  });

  it('returns an undefined description when frontmatter omits it', () => {
    expect(parseFrontmatter('---\ntitle: No description\n---\nBody')).toEqual({
      title: 'No description',
      description: undefined,
      status: 'available',
      body: 'Body',
    });
  });

  it('rejects a document without a leading frontmatter block', () => {
    expect(() => parseFrontmatter('# No frontmatter')).toThrow(/frontmatter/i);
  });

  it('rejects frontmatter without a title', () => {
    expect(() => parseFrontmatter('---\ndescription: Missing title\n---\nBody')).toThrow(/title/i);
  });

  it('rejects a status outside the publication domain', () => {
    expect(() => parseFrontmatter('---\ntitle: Invalid\nstatus: draft\n---\nBody')).toThrow(/status/i);
  });

  it('accepts CRLF frontmatter and body boundaries', () => {
    const markdown = '---\r\ntitle: Windows\r\ndescription: CRLF\r\nstatus: available\r\n---\r\nBody\r\n';

    expect(parseFrontmatter(markdown)).toEqual({
      title: 'Windows',
      description: 'CRLF',
      status: 'available',
      body: 'Body\r\n',
    });
  });

  it('unquotes quoted frontmatter values', () => {
    expect(parseFrontmatter('---\ntitle: "Quoted title"\ndescription: \'Quoted description\'\n---\nBody')).toMatchObject({
      title: 'Quoted title',
      description: 'Quoted description',
    });
  });
});
