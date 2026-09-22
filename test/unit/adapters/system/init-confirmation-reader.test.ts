import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  createInitConfirmationReader,
  type InitConfirmationStreams,
} from '#adapters/system/init-confirmation-reader.js';

class ConfirmationInput extends EventEmitter {
  resumeCalls = 0;
  pauseCalls = 0;

  pause(): this { this.pauseCalls += 1; return this; }
  resume(): this { this.resumeCalls += 1; return this; }
}

function streams(): { readonly stdin: ConfirmationInput; readonly stderr: Writable; readonly output: string[] } {
  const output: string[] = [];
  return {
    stdin: new ConfirmationInput(),
    stderr: new Writable({
      write(chunk, _encoding, callback) { output.push(chunk.toString()); callback(); },
    }),
    output,
  };
}

function adapterStreams(stdin: ConfirmationInput, stderr: Writable): InitConfirmationStreams {
  return { stdin: stdin as unknown as InitConfirmationStreams['stdin'], stderr };
}

describe('createInitConfirmationReader()', () => {
  it.each(['y\n', 'yes\r\n', ' Y \n'])('authorizes %j', async (input) => {
    const { stdin, stderr, output } = streams();
    const answer = createInitConfirmationReader(adapterStreams(stdin, stderr))();
    stdin.emit('data', Buffer.from(input));

    await expect(answer).resolves.toBe('authorized');
    expect(output.join('')).toBe('Write these files? [y/N] ');
  });

  it.each(['n\n', '\n'])('declines %j', async (input) => {
    const { stdin, stderr } = streams();
    const answer = createInitConfirmationReader(adapterStreams(stdin, stderr))();
    stdin.emit('data', Buffer.from(input));
    await expect(answer).resolves.toBe('declined');
  });

  it('declines at EOF and adds one terminal newline', async () => {
    const { stdin, stderr, output } = streams();
    const answer = createInitConfirmationReader(adapterStreams(stdin, stderr))();
    stdin.emit('end');

    await expect(answer).resolves.toBe('declined');
    expect(output.join('')).toBe('Write these files? [y/N] \n');
  });

  it('uses only the first line across buffered chunks', async () => {
    const { stdin, stderr } = streams();
    const answer = createInitConfirmationReader(adapterStreams(stdin, stderr))();
    stdin.emit('data', Buffer.from('y\nextra\n'));
    await expect(answer).resolves.toBe('authorized');
  });

  it('returns interrupted and adds one terminal newline after an abort', async () => {
    const { stdin, stderr, output } = streams();
    const controller = new AbortController();
    const answer = createInitConfirmationReader(adapterStreams(stdin, stderr))(controller.signal);
    controller.abort();

    await expect(answer).resolves.toBe('interrupted');
    expect(output.join('')).toBe('Write these files? [y/N] \n');
  });

  it('does not read stdin when already aborted', async () => {
    const { stdin, stderr, output } = streams();
    const controller = new AbortController();
    controller.abort();
    const once = vi.spyOn(stdin, 'once');

    await expect(createInitConfirmationReader(adapterStreams(stdin, stderr))(controller.signal)).resolves.toBe('interrupted');
    expect(once).not.toHaveBeenCalled();
    expect(stdin.resumeCalls).toBe(0);
    expect(output.join('')).toBe('Write these files? [y/N] \n');
  });

  it('rejects rather than declining when stdin errors', async () => {
    const { stdin, stderr } = streams();
    const failure = new Error('stdin failed');
    const answer = createInitConfirmationReader(adapterStreams(stdin, stderr))();
    stdin.emit('error', failure);

    await expect(answer).rejects.toBe(failure);
  });
});
