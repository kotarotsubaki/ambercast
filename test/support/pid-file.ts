import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Shell redirection creates the file before echo writes the pid. Requiring the
// trailing newline also prevents a partially written positive number from
// looking ready. The caller owns the deadline, including the final read.
// Abort returns undefined so the caller's launch error remains the failure.
export async function readPidFile(file: string, deadline: number, isAborted?: () => boolean): Promise<number | undefined> {
  let content: string | undefined;
  for (;;) {
    if (isAborted?.()) return undefined;
    try {
      content = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      content = undefined;
    }
    if (content !== undefined && /^[1-9]\d*\n$/.test(content)) return Number(content);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out reading pid file ${file}: ${content === undefined ? 'file does not exist' : JSON.stringify(content)}`);
    }
    await delay(Math.min(10, remaining));
  }
}
