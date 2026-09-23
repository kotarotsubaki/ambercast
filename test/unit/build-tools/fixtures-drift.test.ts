import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeGeneratedArtifacts } from '../../../src/build-tools/generate-json-schema.js';
import { getConfigJsonSchema } from '../../../src/core/config/json-schema.js';
import GithubSlugger from 'github-slugger';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

function liveCapabilities() {
  const writes: Array<{ path: string; content: string }> = [];
  writeGeneratedArtifacts({ outDir: '/unused', writeFile: (path, content) => { writes.push({ path, content }); } });
  const write = writes.find(({ path }) => path.endsWith('manifest/capabilities.json'));
  if (!write) throw new Error('missing capabilities producer output');
  return JSON.parse(write.content);
}

describe('committed artifact goldens', () => {
  it.each([
    ['capabilities.json', liveCapabilities],
    ['config-schema.json', getConfigJsonSchema],
  ])('%s equals its live producer and detects a mutated key', (name, producer) => {
    const expected = fixture(name);
    const actual = producer();
    expect(actual).toStrictEqual(expected);
    const mutated = structuredClone(expected);
    mutated[Object.keys(mutated)[0]!] = '__mutated__';
    expect(actual).not.toStrictEqual(mutated);
  });

  it('pins the slugger package in both dependency graphs and resolves it at root', () => {
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const website = JSON.parse(readFileSync(new URL('../../../website/package.json', import.meta.url), 'utf8'));
    expect(root.devDependencies['github-slugger']).toBe('2.0.0');
    expect(website.dependencies['github-slugger']).toBe('2.0.0');
    expect(new GithubSlugger().slug('Hello World')).toBe('hello-world');
  });
});
