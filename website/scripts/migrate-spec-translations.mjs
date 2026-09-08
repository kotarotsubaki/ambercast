import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSpec } from './lib/spec-transform.mjs';

/**
 * Migrates the committed Japanese and Simplified Chinese specification pages through the
 * shared `transformSpec` contract.
 *
 * The command delegates all chapter-level transformations to `spec-transform.mjs`, keeping
 * locale-specific processing aligned with the root locale. It writes one plain-text stderr
 * line per distinct diagnostic without merging or truncating them, exits non-zero on any
 * violation, and performs no partial writes when validation fails.
 *
 * @returns {Promise<void>} Resolves after a complete migration or aggregate failure report.
 */
export async function main() {
  const websiteRoot = process.cwd();
  const repositoryRoot = join(websiteRoot, '..');
  const contentRoot = join(websiteRoot, 'src/content/docs');
  const [version, files, allFiles] = await Promise.all([
    readVersion(join(repositoryRoot, 'package.json')),
    translationSpecFiles(contentRoot),
    markdownFiles(contentRoot),
  ]);
  const documents = await Promise.all(allFiles.map(async (file) => ({ file, markdown: await readFile(file, 'utf8') })));
  const titles = titlesByLocale(documents, contentRoot);
  const candidates = [];
  const diagnostics = [];
  for (const file of files) {
    const page = relative(contentRoot, file);
    const chapter = file.split('/').pop().replace(/\.mdx?$/, '');
    try {
      const locale = page.split('/')[0];
      candidates.push({ file, output: transformSpec(await readFile(file, 'utf8'), { locale, version, titles: titles.get(locale), chapter }) });
    } catch (error) {
      diagnostics.push(...formatDiagnostics(page, error));
    }
  }
  if (diagnostics.length) {
    process.stderr.write(`${[...new Set(diagnostics)].join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  await Promise.all(candidates.map(({ file, output }) => writeFile(file, output)));
}

async function readVersion(path) {
  return JSON.parse(await readFile(path, 'utf8')).version;
}

async function translationSpecFiles(contentRoot) {
  return (await Promise.all(['ja', 'zh-cn'].map((locale) => markdownFiles(join(contentRoot, locale, 'spec'))))).flat();
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

function targetFor(file, contentRoot) {
  return relative(contentRoot, file).replace(/^(ja|zh-cn)\//, '').replace(/\.mdx?$/, '');
}

function titlesByLocale(documents, contentRoot) {
  return new Map(['en', 'ja', 'zh-cn'].map((locale) => [locale, new Map(documents
    .filter(({ file }) => localeFor(relative(contentRoot, file)) === locale)
    .map(({ file, markdown }) => [targetFor(file, contentRoot), frontmatterTitle(markdown) || headingTitle(markdown)]))]));
}

function localeFor(page) {
  return /^(ja|zh-cn)\//.exec(page)?.[1] ?? 'en';
}

function frontmatterTitle(markdown) {
  const title = /^---\r?\n[\s\S]*?^title:\s*(.+?)\s*\r?\n[\s\S]*?^---\s*\r?\n/m.exec(markdown)?.[1];
  if (!title) return '';
  try { return JSON.parse(title); } catch { return title.replace(/^['"]|['"]$/g, ''); }
}

function headingTitle(markdown) {
  return /^# (.+)$/m.exec(markdown)?.[1] ?? '';
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
