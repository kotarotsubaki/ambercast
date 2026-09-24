/**
 * Composes the view command between CLI parsing and the local HTTP adapter.
 *
 * Configuration and read-only run access belong here, while listening, Host
 * checks, and response rendering stay in the HTTP adapter. This keeps HTTP
 * types and server dependencies out of runtime and lets replay remain
 * independent of the viewer.
 */

import { createFsStorage } from '#adapters/storage/fs-storage.js';
import { isIpAddress } from '#adapters/system/ip-address.js';
import { createProcessEnvironmentInfo } from '#adapters/system/process-environment-info.js';
import { readConfigEnvironment } from '#adapters/system/process-config-environment.js';
import { createTtyInteractivityCheck } from '#adapters/system/tty-interactivity.js';
import { loadConfig } from '#config/load.js';
import { ConfigInvalidError } from '#core/errors/config-invalid-error.js';
import { normalizeBindHost } from '#core/viewer/bind-host.js';
import { portCandidates } from '#core/viewer/port-candidates.js';
import {
  getRunReport,
  getRunReportBytes,
  getRunScreenshot,
  listRunReports,
  type RunListing,
} from '#usecases/get-run-report.js';
/** Exposes the listing classification through runtime so HTTP callers need no direct usecase import. */
export type { RunListing } from '#usecases/get-run-report.js';
export { AmbercastError } from '#core/errors/types.js';
/** Exposes viewer copy to CLI through its allowed runtime dependency boundary. */
export { VIEW_COPY } from '#core/viewer/copy.js';

/** Parsed view options and invocation context supplied by the CLI. */
export interface ViewCommandInput {
  /** Explicit port, which disables the configured-port fallback search. */
  readonly port?: number;
  /** Requested bind address; omitted values use the loopback default. */
  readonly host?: string;
  /** Permits use without an interactive terminal, including in CI. */
  readonly allowHeadless: boolean;
  /** Explicit configuration path resolved through the shared config loader. */
  readonly configPathOverride?: string;
  /** Working directory used for configuration and project-root resolution. */
  readonly cwd: string;
  /** CLI diagnostic stream; preparation does not start or announce the server. */
  readonly stderr: NodeJS.WritableStream;
  /** Caller cancellation carried across command preparation. */
  readonly signal?: AbortSignal;
}

/** Environment checks injected so the interactive gate and address policy are testable. */
export interface ViewCommandDeps {
  /** CI state, which prevents terminal attachment alone from authorizing view. */
  readonly isCI: boolean;
  /** Reports whether both stdin and stderr are attached to terminals. */
  readonly isInteractive: () => boolean;
  /** Classifies an address using the system IP parser without importing it into core policy. */
  readonly isIpAddress: (value: string) => 0 | 4 | 6;
}

/**
 * HTTP-neutral server plan and read-only run capabilities for one invocation.
 *
 * The reader bundles closures over storage, layout, and the resolved project
 * root. Callers receive run operations rather than raw filesystem access;
 * this keeps `node:http` and `adapters/http` out of runtime while the HTTP
 * adapter can consume the usecases without importing them directly.
 */
export interface ViewPlan {
  /** Normalized address to bind; `localhost` has become loopback IPv4. */
  readonly bindHost: string;
  /** Ports to try in order, bounded by the valid TCP port range. */
  readonly candidates: readonly number[];
  /** Whether an explicit port forbids trying another candidate. */
  readonly strict: boolean;
  /** Whether CLI should warn that the bound address is not loopback. */
  readonly warn: boolean;
  /** Read-only operations whose classifications and bytes are shared with HTTP routes. */
  readonly reader: {
    /** Lists classified run directories for the index. */
    readonly list: () => Promise<readonly RunListing[]>;
    /** Retrieves one classified run or the common not-found outcome. */
    readonly get: (runId: string) => Promise<RunListing | { readonly kind: 'not-found' }>;
    /** Reads the original report bytes when available. */
    readonly bytes: (runId: string) => Promise<{ readonly kind: 'found'; readonly bytes: Uint8Array } | { readonly kind: 'not-found' }>;
    /** Reads only a screenshot authorized by its run report. */
    readonly screenshot: (runId: string, ref: string) => Promise<{ readonly kind: 'found'; readonly bytes: Uint8Array } | { readonly kind: 'not-found' }>;
  };
}

/**
 * Prepares the view server plan without opening a listening socket.
 *
 * @param input - Parsed options, working directory, diagnostic stream, and cancellation.
 * @param deps - Optional environment and IP checks for command policy.
 * @returns A normalized bind address, ordered port candidates, warning policy,
 * and read-only run capabilities for the HTTP adapter.
 * @throws {ConfigInvalidError} When configuration is invalid, headless use is
 * not authorized, or the requested host is invalid or a wildcard.
 * @remarks
 * Configuration follows the same `loadConfig` path as run, check, and heal so
 * project roots and configured viewer ports have one interpretation. After
 * loading, the interactive gate rejects non-terminal or CI use unless the
 * caller opted in. Host normalization then rejects wildcard exposure before
 * port policy composes either the single explicit candidate or up to twenty
 * configured-port candidates. Binding and retry handling belong to HTTP.
 */
export async function prepareViewCommand(input: ViewCommandInput, deps?: ViewCommandDeps): Promise<ViewPlan> {
  const storage = createFsStorage();
  const { resolved: config } = await loadConfig({
    cwd: input.cwd,
    ...(input.configPathOverride !== undefined && { configPathOverride: input.configPathOverride }),
    storage,
    configEnv: readConfigEnvironment(),
  });

  const environment = deps ?? {
    isCI: createProcessEnvironmentInfo().isCI(),
    isInteractive: createTtyInteractivityCheck(),
    isIpAddress,
  };
  if (!input.allowHeadless && (environment.isCI || !environment.isInteractive())) {
    throw new ConfigInvalidError('view requires --allow-headless when no interactive terminal is attached.');
  }

  const bind = normalizeBindHost(input.host, environment.isIpAddress);
  if ('error' in bind) {
    throw new ConfigInvalidError(bind.error === 'wildcard'
      ? 'The --host value must be a specific address, not a wildcard.'
      : 'The --host value must be an IP address or localhost.');
  }

  const runDeps = { storage, runsDir: config.runsDir, projectRoot: config.projectRoot };
  return {
    bindHost: bind.host,
    candidates: portCandidates({
      ...(input.port !== undefined && { explicit: input.port }),
      configured: config.viewer.port,
      fallback: 4600,
    }),
    strict: input.port !== undefined,
    warn: bind.host !== '127.0.0.1' && bind.host !== '::1',
    reader: {
      list: () => listRunReports(runDeps),
      get: (runId) => getRunReport(runDeps, runId),
      bytes: (runId) => getRunReportBytes(runDeps, runId),
      screenshot: (runId, ref) => getRunScreenshot(runDeps, runId, ref),
    },
  };
}
