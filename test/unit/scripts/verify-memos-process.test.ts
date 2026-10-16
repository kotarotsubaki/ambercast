/** Real OS signals exercise the event-loop boundary that synchronous emits cannot. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const childFixture = fileURLToPath(new URL('./support/verify-memos-signal-child.mjs', import.meta.url));
const prompt = 'tests/ambercast/memos-sign-in-create-memo.test.md';
const plan = prompt.replace('.test.md', '.ambercast.plan.json');
const grounding = prompt.replace('.test.md', '.ambercast.grounding.json');

describe.skipIf(process.platform === 'win32')('verify-memos real publication signals', () => {
  it.each(['external', 'poll'].flatMap(mode => [false, true].map(keep => ({ mode, keep }))))
  ('TEST-78 completes publication and tears down for $mode SIGINT (keep=$keep)', async ({ mode, keep }) => {
    const root = fs.mkdtempSync(join(tmpdir(), 'ambercast-memos-signal-'));
    let child: ChildProcessWithoutNullStreams | undefined;
    let stdout = '', stderr = '';
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      child = spawn(process.execPath, [childFixture, root, mode, keep ? 'keep' : 'cleanup'], { stdio: 'pipe' });
      const running = child;
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        let signalSent = false;
        running.once('error', reject);
        running.stdout.on('data', chunk => {
          stdout += chunk.toString();
          if (mode === 'external' && !signalSent && stdout.split('\n').includes('PUBLISH_START')) {
            signalSent = true;
            try {
              if (!running.kill('SIGINT')) throw new Error('child exited before publication signal');
              fs.writeFileSync(join(root, 'signal-sent'), 'sent');
            } catch (error) { reject(error); }
          }
        });
        running.stderr.on('data', chunk => { stderr += chunk.toString(); });
        running.once('close', (code, signal) => resolve({ code, signal }));
      });
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`bounded signal test timed out\n${stdout}\n${stderr}`)), 10000);
      });
      const exit = await Promise.race([closed, timedOut]);
      // Soft assertions retain independent publication and cleanup evidence
      // when exit handling also fails, making combined failures diagnosable.
      expect.soft(exit, `${stdout}\n${stderr}`).toEqual({ code: 130, signal: null });
      const fixture = join(root, 'repo/test/verification/memos/fixture');
      expect.soft(JSON.parse(fs.readFileSync(join(fixture, 'ambercast.config.json'), 'utf8')))
        .toEqual({ secrets: { allow: ['memos.password'] }, generated: 'config' });
      expect.soft(fs.readFileSync(join(fixture, plan), 'utf8')).toBe('{"generated":"plan"}\n');
      expect.soft(fs.readFileSync(join(fixture, grounding), 'utf8')).toBe('{"generated":"grounding"}\n');
      expect.soft(fs.existsSync(join(fixture, '.lock'))).toBe(false);
      expect.soft(stdout).toContain(mode === 'external' ? 'PUBLISH_START\n' : 'RAISED\n');
      const stateLine = stdout.split('\n').find(line => line.startsWith('FINAL_STATE '));
      expect.soft(stateLine, `${stdout}\n${stderr}`).toBeDefined();
      if (stateLine) {
        const state = JSON.parse(stateLine.slice('FINAL_STATE '.length));
        expect.soft(state.containers).toEqual([]);
        expect.soft(state.runRoots).toEqual([]);
        // One reset removal plus final cleanup proves --keep cannot bypass teardown.
        expect.soft(state.removals).toBe(2);
      }
      expect.soft(fs.readdirSync(root).filter(name => name.startsWith('ambercast-verify-memos-'))).toEqual([]);
      expect.soft(stdout).toContain('reason=interrupted');
      expect.soft(stdout).toContain('aiCalls=n/a');
    } finally {
      clearTimeout(deadline);
      if (child) {
        const stopped = child.exitCode !== null || child.signalCode !== null;
        if (!stopped) {
          const closed = new Promise<void>(resolve => {
            const timeout = setTimeout(resolve, 1000);
            child!.once('close', () => { clearTimeout(timeout); resolve(); });
          });
          child.kill('SIGKILL');
          await closed;
        } else child.kill('SIGKILL');
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15000);
});
