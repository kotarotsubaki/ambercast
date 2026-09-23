import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../../bin/ambercast.js', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('real init and check CLI', () => {
  it('creates a config accepted by check, which then reports the missing plan', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ambercast-init-check-'));
    temporaryDirectories.push(cwd);

    const init = spawnSync(process.execPath, [bin, 'init', '--yes'], { cwd, encoding: 'utf8' });
    expect(init.error).toBeUndefined();
    expect(init.status).toBe(0);

    const check = spawnSync(process.execPath, [bin, 'check', 'tests/ambercast/find-page.test.md', '--json'], { cwd, encoding: 'utf8' });
    expect(check.error).toBeUndefined();
    expect(`${check.stdout}${check.stderr}`).not.toContain('CONFIG_INVALID');
    expect(check.status).toBe(4);
    const report = JSON.parse(check.stdout) as { results: Array<{ status: string }> };
    expect(report.results).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'missing-plan' })]));
  });
});
