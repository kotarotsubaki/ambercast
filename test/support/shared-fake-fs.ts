import type { PathLike } from 'node:fs';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export type SharedFakeFsOperation = 'lstat' | 'writeFile' | 'readFile' | 'rename' | 'rm' | 'unlink';
export type SharedFakeFsPhase = 'before' | 'after';

export interface SharedFakeFsBarrier {
  readonly entered: Promise<void>;
  readonly release: () => void;
}

interface PendingBarrier {
  readonly operation: SharedFakeFsOperation;
  readonly path: string;
  readonly phase: SharedFakeFsPhase;
  readonly entered: Deferred<void>;
  readonly released: Deferred<void>;
}

export interface SharedFakeFsCall {
  readonly operation: SharedFakeFsOperation;
  readonly path: string;
  readonly phase: SharedFakeFsPhase;
}

function filesystemError(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}

function stringPath(path: PathLike): string {
  if (typeof path !== 'string') {
    throw new TypeError('SharedFakeFs accepts string paths only.');
  }

  return path;
}

function bytesFrom(data: unknown): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }

  throw new TypeError('SharedFakeFs accepts string or Uint8Array file content only.');
}

function requestsUtf8(options: unknown): boolean {
  return options === 'utf8'
    || (typeof options === 'object' && options !== null && 'encoding' in options && options.encoding === 'utf8');
}

/**
 * Models the small filesystem namespace exercised by the exclusive-update
 * adapter tests. Barriers can pause either side of one matching operation so
 * independently-created adapters can be interleaved deterministically.
 */
export class SharedFakeFs {
  readonly calls: SharedFakeFsCall[] = [];
  private readonly files = new Map<string, Uint8Array>();
  private readonly symbolicLinks = new Set<string>();
  private readonly barriers: PendingBarrier[] = [];

  setText(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
    this.symbolicLinks.delete(path);
  }

  setSymbolicLink(path: string): void {
    this.symbolicLinks.add(path);
    this.files.delete(path);
  }

  text(path: string): string | null {
    const bytes = this.files.get(path);
    return bytes === undefined ? null : new TextDecoder().decode(bytes);
  }

  has(path: string): boolean {
    return this.files.has(path) || this.symbolicLinks.has(path);
  }

  pauseNext(operation: SharedFakeFsOperation, path: string, phase: SharedFakeFsPhase = 'before'): SharedFakeFsBarrier {
    const entered = createDeferred<void>();
    const released = createDeferred<void>();
    this.barriers.push({ operation, path, phase, entered, released });
    return { entered: entered.promise, release: () => released.resolve() };
  }

  readonly lstat = async (pathLike: PathLike): Promise<{
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }> => {
    const path = stringPath(pathLike);
    await this.checkpoint('lstat', path, 'before');
    if (!this.has(path)) {
      throw filesystemError('ENOENT', path);
    }

    const symbolicLink = this.symbolicLinks.has(path);
    const result = {
      isFile: () => !symbolicLink,
      isSymbolicLink: () => symbolicLink,
    };
    await this.checkpoint('lstat', path, 'after');
    return result;
  };

  readonly writeFile = async (pathLike: PathLike, data: unknown, options?: unknown): Promise<void> => {
    const path = stringPath(pathLike);
    await this.checkpoint('writeFile', path, 'before');
    if (typeof options === 'object' && options !== null && 'flag' in options && options.flag === 'wx' && this.has(path)) {
      throw filesystemError('EEXIST', path);
    }

    this.files.set(path, bytesFrom(data));
    this.symbolicLinks.delete(path);
    await this.checkpoint('writeFile', path, 'after');
  };

  readonly readFile = async (pathLike: PathLike, options?: unknown): Promise<Buffer | string> => {
    const path = stringPath(pathLike);
    await this.checkpoint('readFile', path, 'before');
    const bytes = this.files.get(path);
    if (bytes === undefined) {
      throw filesystemError('ENOENT', path);
    }

    const result = requestsUtf8(options)
      ? new TextDecoder().decode(bytes)
      : Buffer.from(bytes);
    await this.checkpoint('readFile', path, 'after');
    return result;
  };

  readonly rename = async (oldPathLike: PathLike, newPathLike: PathLike): Promise<void> => {
    const oldPath = stringPath(oldPathLike);
    const newPath = stringPath(newPathLike);
    await this.checkpoint('rename', oldPath, 'before');
    const bytes = this.files.get(oldPath);
    if (bytes === undefined) {
      throw filesystemError('ENOENT', oldPath);
    }

    this.files.set(newPath, bytes);
    this.files.delete(oldPath);
    this.symbolicLinks.delete(newPath);
    await this.checkpoint('rename', oldPath, 'after');
  };

  readonly rm = async (pathLike: PathLike): Promise<void> => {
    const path = stringPath(pathLike);
    await this.checkpoint('rm', path, 'before');
    this.files.delete(path);
    this.symbolicLinks.delete(path);
    await this.checkpoint('rm', path, 'after');
  };

  readonly unlink = async (pathLike: PathLike): Promise<void> => {
    const path = stringPath(pathLike);
    await this.checkpoint('unlink', path, 'before');
    if (!this.has(path)) {
      throw filesystemError('ENOENT', path);
    }

    this.files.delete(path);
    this.symbolicLinks.delete(path);
    await this.checkpoint('unlink', path, 'after');
  };

  private async checkpoint(
    operation: SharedFakeFsOperation,
    path: string,
    phase: SharedFakeFsPhase,
  ): Promise<void> {
    this.calls.push({ operation, path, phase });
    const index = this.barriers.findIndex((barrier) => (
      barrier.operation === operation && barrier.path === path && barrier.phase === phase
    ));
    if (index < 0) {
      return;
    }

    const [barrier] = this.barriers.splice(index, 1);
    if (barrier === undefined) {
      return;
    }

    barrier.entered.resolve();
    await barrier.released.promise;
  }
}
