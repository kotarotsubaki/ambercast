import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

export function createDocsFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'ambercast-docs-test-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
  return {
    root,
    website: join(root, 'website'),
    read(relativePath: string) { return readFileSync(join(root, relativePath), 'utf8'); },
    dispose() { rmSync(root, { recursive: true, force: true }); },
  };
}

export function runEntryPoint(script: URL, cwd: string) {
  return spawnSync(process.execPath, [script.pathname], { cwd, encoding: 'utf8' });
}
