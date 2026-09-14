import { displayLine } from '#adapters/system/confirmation-answer-reader.js';
import { abortReason } from '#core/ai/reject-on-abort.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { UnexpectedCrashError } from '#core/errors/unexpected-crash-error.js';
import { relativeWithin } from '#core/paths.js';
import { envVarNameFor } from '#core/secrets/env-var-name.js';
import type {
  ConsentCapability,
  ConsentRequest,
  SecretRename,
} from '#usecases/generate.js';
import type { SecretUse } from '#usecases/secret-naming.js';

type ConsentInput = Pick<NodeJS.ReadableStream, 'on' | 'removeListener' | 'pause' | 'resume'>;

interface Participant {
  readonly file: string;
  readonly displayFile: string;
  readonly name: SecretUse['name'];
  readonly stepIds: SecretUse['stepId'][];
  readOnly: boolean;
}

function participantKey(file: string, name: string): string {
  return JSON.stringify([file, name]);
}

function displayPath(file: string, configPath: string | null): string {
  if (configPath === null) {
    return file;
  }

  const separator = configPath.lastIndexOf('/');
  const projectRoot = separator === 0 ? '/' : configPath.slice(0, Math.max(0, separator));
  return relativeWithin(projectRoot, file) ?? file;
}

function useEnvironmentName(use: SecretUse): string {
  const projected = use as SecretUse & { readonly envVar?: unknown };
  return typeof projected.envVar === 'string' ? projected.envVar : envVarNameFor(use.ref);
}

function write(output: NodeJS.WritableStream, text: string): void {
  try {
    output.write(text);
  } catch (error) {
    throw new FsIoError('Secret consent output could not be written.', undefined, { cause: error });
  }
}

function createLineReader(input: ConsentInput, signal?: AbortSignal): {
  readonly readLine: () => Promise<string | null>;
  readonly close: () => void;
} {
  const lines: string[] = [];
  const waiters: Array<{
    readonly resolve: (line: string | null) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  let buffered = '';
  let ended = false;
  let failure: unknown;
  let listening = true;

  const settle = (): void => {
    while (waiters.length > 0 && lines.length > 0) {
      waiters.shift()!.resolve(lines.shift()!);
    }
    if (failure !== undefined) {
      while (waiters.length > 0) {
        waiters.shift()!.reject(failure);
      }
    } else if (ended) {
      while (waiters.length > 0) {
        waiters.shift()!.resolve(null);
      }
    }
  };
  const onData = (chunk: Buffer | string): void => {
    buffered += chunk.toString();
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      lines.push(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
    }
    settle();
  };
  const onEnd = (): void => {
    if (buffered.length > 0) {
      lines.push(buffered);
      buffered = '';
    }
    ended = true;
    settle();
  };
  const onError = (error: unknown): void => {
    failure = new FsIoError('Secret consent input could not be read.', undefined, { cause: error });
    settle();
  };
  const onAbort = (): void => {
    failure = abortReason(signal!);
    settle();
  };
  const close = (): void => {
    if (!listening) {
      return;
    }
    listening = false;
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('error', onError);
    signal?.removeEventListener('abort', onAbort);
    input.pause();
  };

  input.on('data', onData);
  input.on('end', onEnd);
  input.on('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted === true) {
    onAbort();
  } else {
    input.resume();
  }

  return {
    readLine: () => {
      if (lines.length > 0) {
        return Promise.resolve(lines.shift()!);
      }
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      if (ended) {
        return Promise.resolve(null);
      }
      return new Promise<string | null>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    close,
  };
}

function renderRequest(output: NodeJS.WritableStream, request: ConsentRequest): Participant[] {
  const participants: Participant[] = [];
  const byKey = new Map<string, Participant>();

  for (const item of request.items) {
    const displayFile = displayPath(item.file, request.configPath);
    const names = new Set(item.uses.map(({ name }) => name));
    write(output, `${displayLine(displayFile)} needs ${names.size} secret(s):\n`);

    for (const use of item.uses) {
      const reason = use.target === undefined
        ? `ai step "${displayLine(use.stepId)}" declares secret use`
        : `fill-secret → ${displayLine(use.target.role)} "${displayLine(use.target.name)}"`;
      write(
        output,
        `  ${displayLine(use.name)}  ${displayLine(use.stepId)}  ${reason}  env ${displayLine(useEnvironmentName(use))}\n`,
      );

      const key = participantKey(item.file, use.name);
      const existing = byKey.get(key);
      if (existing === undefined) {
        const participant: Participant = {
          file: item.file,
          displayFile,
          name: use.name,
          stepIds: [use.stepId],
          readOnly: use.selectionSource === 'existing-plan',
        };
        participants.push(participant);
        byKey.set(key, participant);
      } else {
        if (!existing.stepIds.includes(use.stepId)) {
          existing.stepIds.push(use.stepId);
        }
        existing.readOnly ||= use.selectionSource === 'existing-plan';
      }
    }
  }

  return participants;
}

function renderParticipant(output: NodeJS.WritableStream, participant: Participant): void {
  const steps = participant.stepIds.map(displayLine).join(', ');
  const identity = `${displayLine(participant.displayFile)} secret ${displayLine(participant.name)} (steps ${steps})`;
  if (participant.readOnly) {
    write(output, `${identity} is read-only: keep (Enter) / n `);
  } else {
    write(output, `${identity}: keep (Enter) / <new name> / n `);
  }
}

async function editParticipant(
  participant: Participant,
  reader: ReturnType<typeof createLineReader>,
  output: NodeJS.WritableStream,
): Promise<{ readonly declined: true } | { readonly declined: false; readonly newName?: SecretUse['name'] }> {
  for (;;) {
    renderParticipant(output, participant);
    const line = await reader.readLine();
    if (line === null) {
      return { declined: true };
    }

    const answer = line.trim();
    if (answer.toLowerCase() === 'n') {
      return { declined: true };
    }
    if (participant.readOnly && answer !== '') {
      continue;
    }
    if (answer === '' || answer === participant.name) {
      return { declined: false };
    }
    return { declined: false, newName: answer as SecretUse['name'] };
  }
}

async function requestIndividualDecision(
  request: ConsentRequest,
  participants: readonly Participant[],
  reader: ReturnType<typeof createLineReader>,
  output: NodeJS.WritableStream,
): Promise<Awaited<ReturnType<ConsentCapability['request']>>> {
  const renames = new Map<string, SecretRename>();
  let toEdit = [...participants];

  while (toEdit.length > 0) {
    for (const participant of toEdit) {
      const edited = await editParticipant(participant, reader, output);
      if (edited.declined) {
        return { kind: 'declined' };
      }

      const key = participantKey(participant.file, participant.name);
      if (edited.newName === undefined) {
        renames.delete(key);
      } else {
        renames.set(key, {
          file: participant.file,
          name: participant.name,
          newName: edited.newName,
        });
      }
    }

    const validation = request.validateRenames([...renames.values()]);
    if (validation.ok) {
      break;
    }

    const failed = new Set(validation.failedKeys.map(({ file, name }) => participantKey(file, name)));
    toEdit = participants.filter((participant) => (
      !participant.readOnly && failed.has(participantKey(participant.file, participant.name))
    ));
    if (toEdit.length === 0 || toEdit.length !== failed.size) {
      throw new UnexpectedCrashError('Secret rename validation returned invalid retry keys.');
    }
  }

  return { kind: 'allowed', renames: [...renames.values()] };
}

/**
 * Creates the interactive half of the secret-consent capability.
 *
 * @param deps - Injected terminal streams, interactivity decision, and
 *   cancellation boundary.
 * @returns A request function that returns one terminal consent decision.
 *
 * @remarks
 * The reader owns only interactive selection and renaming. Injected streams
 * keep terminal behavior testable, and stderr-only output leaves stdout
 * available to machine-readable reports. A non-interactive terminal resolves
 * without output; command composition owns the shared diagnostic for every
 * rendering mode (SPEC-C2-4, SPEC-C2-5).
 */
export function createInteractiveSecretConsent(deps: {
  /** Source of terminal responses, injected instead of reading process stdin directly. */
  readonly input: NodeJS.ReadableStream;
  /** Diagnostic-only destination; production composition provides stderr. */
  readonly output: NodeJS.WritableStream;
  /** Runtime-owned TTY/CI decision that prevents prompting where input is unavailable. */
  readonly isInteractive: () => boolean;
  /** Optional batch interruption boundary shared with generation. */
  readonly signal?: AbortSignal;
}): ConsentCapability['request'] {
  return async (request) => {
    if (!deps.isInteractive()) {
      return { kind: 'not-interactive' };
    }
    if (deps.signal?.aborted === true) {
      throw abortReason(deps.signal);
    }

    const reader = createLineReader(deps.input, deps.signal);
    try {
      const participants = renderRequest(deps.output, request);
      const distinctNames = new Set(participants.map(({ name }) => name)).size;
      const useCount = request.items.reduce((total, { uses }) => total + uses.length, 0);
      const configPath = request.configPath ?? 'ambercast.config.json';
      write(
        deps.output,
        `Allow ${distinctNames} secret(s) (${useCount} uses) and save to ${displayLine(configPath)}? [y/N/i] `,
      );

      const answer = await reader.readLine();
      if (answer === null) {
        return { kind: 'declined' };
      }
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'y' || normalized === 'yes') {
        return { kind: 'allowed', renames: [] };
      }
      if (normalized !== 'i') {
        return { kind: 'declined' };
      }

      return requestIndividualDecision(request, participants, reader, deps.output);
    } finally {
      reader.close();
    }
  };
}
