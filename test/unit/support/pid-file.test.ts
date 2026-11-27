// A shell creates its redirected pid file before echo finishes writing it, so
// readiness depends on complete content rather than the file's existence.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { readPidFile } from '../../support/pid-file.js';

const roots: string[] = [];
function pidFile(): string {
  const root = fs.mkdtempSync(join(tmpdir(), 'ambercast-pid-file-'));
  roots.push(root);
  return join(root, 'pid');
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('readPidFile', () => {
  it.each(['', '12', '0\n', '-5\n', 'abc\n', '1.5\n'])('rejects incomplete or invalid content %j at the deadline', async content => {
    const file = pidFile();
    fs.writeFileSync(file, content);
    expect(fs.existsSync(file)).toBe(true);
    const deadline = Date.now() + 30;
    const error = await readPidFile(file, deadline).catch((caught: unknown) => caught);
    expect(Date.now()).toBeGreaterThanOrEqual(deadline);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(file);
    expect((error as Error).message).toContain(JSON.stringify(content));
  });

  it('waits for a late complete pid within the original deadline', async () => {
    const file = pidFile();
    fs.writeFileSync(file, '');
    const deadline = Date.now() + 5000;
    const reading = readPidFile(file, deadline);
    await delay(20);
    fs.writeFileSync(file, '4242\n');
    expect(await reading).toBe(4242);
    expect(Date.now()).toBeLessThan(deadline);
  });

  it('names an absent file when its deadline expires', async () => {
    const file = pidFile();
    const error = await readPidFile(file, Date.now() + 30).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(file);
    expect((error as Error).message).toContain('does not exist');
  });

  it('returns undefined before reading even a valid file when already aborted', async () => {
    const file = pidFile();
    fs.writeFileSync(file, '4242\n');
    const deadline = Date.now() + 5000;
    expect(await readPidFile(file, deadline, () => true)).toBeUndefined();
    expect(Date.now()).toBeLessThan(deadline);
  });

  it('stops waiting on abort so the caller propagates its launch error', async () => {
    const file = pidFile();
    let rejected = false;
    const launchError = new Error('launch failed');
    const deadline = Date.now() + 5000;
    const reading = (async () => {
      const pid = await readPidFile(file, deadline, () => rejected);
      if (rejected) throw launchError;
      return pid;
    })();
    const assertion = expect(reading).rejects.toBe(launchError);
    await delay(20);
    rejected = true;
    await assertion;
    expect(Date.now()).toBeLessThan(deadline);
  });

  it('returns undefined without throwing when aborted while waiting', async () => {
    const file = pidFile();
    let aborted = false;
    const deadline = Date.now() + 5000;
    const reading = readPidFile(file, deadline, () => aborted);
    await delay(20);
    aborted = true;
    expect(await reading).toBeUndefined();
    expect(Date.now()).toBeLessThan(deadline);
  });

  it('checks complete content even when the deadline has already passed', async () => {
    const file = pidFile();
    fs.writeFileSync(file, '4242\n');
    expect(await readPidFile(file, Date.now() - 1)).toBe(4242);
  });
});
