import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractIntroFigures } from './lib/intro-figures.mjs';

/**
 * Generates committed introduction-figure data from the three localized Markdown sources.
 *
 * The default `root` reads the live `src/content/docs/` tree. After issue #297's MDX
 * conversion, that tree no longer contains the introduction figure bullets, so the default
 * invocation is expected to fail. Reproduce the historical extraction by setting `root` to a
 * pre-conversion tree, such as one assembled from `test/fixtures/intro-source-{en,ja,zh-cn}.md`,
 * or by using a pre-conversion Git revision. The migration completes every read and validation
 * before creating or replacing an output file, so an editorial error cannot leave one locale
 * fresh while another remains stale. Storage failures after writes begin are outside this
 * cross-file atomicity guarantee.
 *
 * @param {{ root?: string }} [options] Website root containing the source docs and generated data.
 * @returns {Promise<void>} Resolves after every locale's JSON data is written, or rejects before
 * any output write when a source document cannot be parsed or validated.
 */
export async function main({ root = process.cwd() } = {}) {
  const docsRoot = join(root, 'src/content/docs');
  const dataRoot = join(root, 'src/data/intro');
  const sources = [
    { locale: 'en', file: join(docsRoot, 'introduction.md') },
    { locale: 'ja', file: join(docsRoot, 'ja/introduction.md') },
    { locale: 'zh-cn', file: join(docsRoot, 'zh-cn/introduction.md') },
  ];
  const candidates = await Promise.all(sources.map(async ({ locale, file }) => {
    let markdown;
    try {
      markdown = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `Introduction figure source not found: ${file}. The live docs tree no longer contains the pre-conversion introduction figure bullets; rerun with main({ root: '<pre-conversion website root>' }) or use a pre-conversion Git revision.`,
          { cause: error },
        );
      }
      throw error;
    }
    return { locale, figures: extractIntroFigures(markdown, { locale }) };
  }));

  await mkdir(dataRoot, { recursive: true });
  await Promise.all(candidates.map(({ locale, figures }) => (
    writeFile(join(dataRoot, `${locale}.json`), `${JSON.stringify(figures, null, 2)}\n`)
  )));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
