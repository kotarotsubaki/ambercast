import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSpec } from './lib/spec-transform.mjs';

/**
 * Generates root-locale specification pages at build time from the committed source chapters.
 *
 * The shared `transformSpec` primitive owns metadata, repository-token, and wikilink
 * semantics. Diagnostics aggregate all invalid chapters into one plain-text stderr line per
 * distinct problem without merging or truncation; any violation produces a non-zero exit
 * status and no partial writes.
 *
 * @returns {Promise<void>} Resolves after all generated pages are written atomically or
 * after every detected violation has been reported.
 */
export async function main() {
  const websiteRoot = process.cwd();
  const repositoryRoot = join(websiteRoot, '..');
  const sourceRoot = join(repositoryRoot, 'docs/spec');
  const contentRoot = join(websiteRoot, 'src/content/docs');
  const [version, sources, placed] = await Promise.all([
    readVersion(join(repositoryRoot, 'package.json')),
    markdownFiles(sourceRoot),
    markdownFiles(contentRoot),
  ]);
  const sourceDocuments = await Promise.all(sources.map(async (file) => ({ file, markdown: await readFile(file, 'utf8') })));
  const placedDocuments = await Promise.all(placed.map(async (file) => ({ file, markdown: await readFile(file, 'utf8') })));
  const titles = titlesFor(placedDocuments, contentRoot).get('en');
  for (const { file, markdown } of sourceDocuments) titles.set(`spec/${basenameWithoutExtension(file)}`, headingTitle(markdown));

  const candidates = [];
  const diagnostics = [];
  for (const { file, markdown } of sourceDocuments) {
    const chapter = basenameWithoutExtension(file);
    try {
      candidates.push({ file: join(contentRoot, 'spec', `${chapter}.md`), output: transformSpec(markdown, { locale: 'en', version, titles, chapter }) });
    } catch (error) {
      diagnostics.push(...formatDiagnostics(`${chapter}.md`, error));
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

async function readVersion(path) {
  return JSON.parse(await readFile(path, 'utf8')).version;
}

async function markdownFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return /\.mdx?$/.test(entry.name) ? [path] : [];
    }))).flat();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function titlesFor(documents, contentRoot) {
  return new Map(['en', 'ja', 'zh-cn'].map((locale) => [locale, new Map(documents
    .filter(({ file }) => localeFor(relative(contentRoot, file)) === locale)
    .map(({ file, markdown }) => [targetFor(file, contentRoot), frontmatterTitle(markdown) || headingTitle(markdown)]))]));
}

function localeFor(page) {
  return /^(ja|zh-cn)\//.exec(page)?.[1] ?? 'en';
}

function targetFor(file, contentRoot) {
  return relative(contentRoot, file).replace(/^(ja|zh-cn)\//, '').replace(/\.mdx?$/, '');
}

function frontmatterTitle(markdown) {
  const title = /^---\r?\n[\s\S]*?^title:\s*(.+?)\s*\r?\n[\s\S]*?^---\s*\r?\n/m.exec(markdown)?.[1];
  if (!title) return '';
  try { return JSON.parse(title); } catch { return title.replace(/^['"]|['"]$/g, ''); }
}

function headingTitle(markdown) {
  return /^# (.+)$/m.exec(markdown)?.[1] ?? '';
}

function basenameWithoutExtension(file) {
  return file.split('/').pop().replace(/\.mdx?$/, '');
}

function formatDiagnostics(page, error) {
  const messages = String(error.message).split('\n').filter(Boolean);
  const unresolved = new Set(messages.filter((message) => message.startsWith('unresolved wikilink: ')).map((message) => message.slice(21)));
  return messages.filter((diagnostic) => {
    if (!diagnostic.startsWith('malformed wikilink: ')) return true;
    const links = [...diagnostic.matchAll(/\[\[([a-z0-9/-]+)(?:#([a-z0-9-]+))?\]\]/g)].map((match) => match[2] ? `${match[1]}#${match[2]}` : match[1]);
    return !links.length || !links.every((target) => unresolved.has(target));
  }).map((diagnostic) => {
    if (diagnostic.startsWith('Expected exactly one H1')) return `${page}: expected exactly one H1`;
    if (diagnostic.startsWith('unresolved wikilink: ')) return `${page}: unresolved wikilink ${JSON.stringify(diagnostic.slice(21))}`;
    if (diagnostic.startsWith('malformed wikilink: ')) return `${page}: malformed wikilink ${JSON.stringify(/\[\[[^\]]*\]\]/.exec(diagnostic.slice(20))?.[0] ?? diagnostic.slice(20))}`;
    return `${page}: ${diagnostic}`;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
