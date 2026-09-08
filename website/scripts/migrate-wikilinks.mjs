import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertWikilinks, splitByCodeRegions } from './lib/wikilinks.mjs';

/**
 * Rewrites ordinary placed pages from source wikilinks to canonical documentation URLs.
 *
 * `convertWikilinks` requires a complete cross-locale title map, including specification
 * pages. The script delegates code-boundary handling and link validation to the shared
 * `wikilinks.mjs` primitive; the setup-prompt bare-URL fence carve-out remains at this caller
 * boundary. It writes one plain-text diagnostic line to stderr for each distinct problem
 * without merging or truncating them, uses a non-zero exit status for any violation, and
 * stages no file writes until the full input set validates.
 *
 * @returns {Promise<void>} Resolves after all links migrate or all errors are reported.
 */
export async function main() {
  const contentRoot = join(process.cwd(), 'src/content/docs');
  const files = await markdownFiles(contentRoot);
  const documents = await Promise.all(files.map(async (file) => ({ file, markdown: await readFile(file, 'utf8') })));
  const titles = titlesByLocale(documents, contentRoot);
  const candidates = [];
  const diagnostics = [];

  for (const document of documents) {
    const page = relative(contentRoot, document.file);
    try {
      const locale = localeFor(page);
      let output = convertWikilinks(document.markdown, { locale, titles: titles.get(locale) });
      if (page.replace(/\.mdx?$/, '') === 'agents/setup-prompt' || /^(ja|zh-cn)\/agents\/setup-prompt\.mdx?$/.test(page)) {
        output = convertSetupPromptFences(output, { locale, titles: titles.get(locale) });
      }
      candidates.push({ file: document.file, output });
    } catch (error) {
      diagnostics.push(...formatDiagnostics(page, error));
    }
  }

  if (diagnostics.length) {
    process.stderr.write(`${[...new Set(diagnostics)].join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  await Promise.all(candidates.map(async ({ file, output }) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, output);
  }));
}

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return /\.mdx?$/.test(entry.name) ? [path] : [];
  }))).flat();
}

function targetFor(file, contentRoot) {
  const page = relative(contentRoot, file).replace(/\.mdx?$/, '');
  return page.replace(/^(ja|zh-cn)\//, '');
}

function titlesByLocale(documents, contentRoot) {
  return new Map(['en', 'ja', 'zh-cn'].map((locale) => [locale, new Map(documents
    .filter(({ file }) => localeFor(relative(contentRoot, file)) === locale)
    .map(({ file, markdown }) => [targetFor(file, contentRoot), frontmatterTitle(markdown)]))]));
}

function localeFor(page) {
  const match = /^(ja|zh-cn)\//.exec(page);
  return match?.[1] ?? 'en';
}

function frontmatterTitle(markdown) {
  const title = /^---\r?\n[\s\S]*?^title:\s*(.+?)\s*\r?\n[\s\S]*?^---\s*\r?\n/m.exec(markdown)?.[1];
  if (!title) return '';
  try {
    return JSON.parse(title);
  } catch {
    return title.replace(/^['"]|['"]$/g, '');
  }
}

function convertSetupPromptFences(markdown, { locale, titles }) {
  return splitByCodeRegions(markdown).map((region) => {
    if (!region.isCode) return region.text;
    const diagnostics = [];
    const converted = region.text.replace(/\[\[([a-z0-9/-]+)(?:#([a-z0-9-]+))?\]\]/g, (source, target, anchor) => {
      const title = titles.get(target);
      if (!title) {
        diagnostics.push(`unresolved wikilink: ${anchor ? `${target}#${anchor}` : target}`);
        return source;
      }
      const prefix = locale === 'en' ? '' : `${locale}/`;
      return `https://kotarotsubaki.github.io/ambercast/${prefix}${target}/${anchor ? `#${anchor}` : ''}`;
    });
    if (diagnostics.length) throw new Error(diagnostics.join('\n'));
    return converted;
  }).join('');
}

function formatDiagnostics(page, error) {
  const messages = String(error.message).split('\n').filter(Boolean);
  const unresolved = new Set(messages.filter((message) => message.startsWith('unresolved wikilink: ')).map((message) => message.slice(21)));
  return messages.filter((diagnostic) => {
    if (!diagnostic.startsWith('malformed wikilink: ')) return true;
    const links = [...diagnostic.matchAll(/\[\[([a-z0-9/-]+)(?:#([a-z0-9-]+))?\]\]/g)].map((match) => match[2] ? `${match[1]}#${match[2]}` : match[1]);
    return !links.length || !links.every((target) => unresolved.has(target));
  }).map((diagnostic) => {
    if (diagnostic.startsWith('unresolved wikilink: ')) return `${page}: unresolved wikilink ${JSON.stringify(diagnostic.slice(21))}`;
    if (diagnostic.startsWith('malformed wikilink: ')) return `${page}: malformed wikilink ${JSON.stringify(/\[\[[^\]]*\]\]/.exec(diagnostic.slice(20))?.[0] ?? diagnostic.slice(20))}`;
    return `${page}: ${diagnostic}`;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
