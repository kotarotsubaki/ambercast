/**
 * Parses CLI arguments, delegates parsed init, generate, run, check, and heal commands to
 * runtime, and selects the only process-exit boundary in the product.
 *
 * The `generate [files...]` and `run [files...]` subcommands both treat
 * positionals as literal prompt paths, delegating an empty list to configured
 * discovery. Generate parses generation policy and rendering flags; run parses
 * replay policy including path grep, target, headed execution, cache policy,
 * stale handling, provider override, color control, and JSON rendering; check
 * parses its read-only target, empty-selection, listing, configuration, and
 * rendering options before runtime dispatch. The parser accepts
 * only the supported provider names, keeping provider selection a runtime
 * concern rather than a usecase option. A bare `--` ends option parsing so a
 * prompt whose literal path begins with `--` remains addressable.
 *
 * Top-level `--version` and `--help` short-circuit before subcommand lookup;
 * command-local help does likewise after a recognized subcommand. Version
 * text uses the build-time `__VERSION__` constant rather than reading package
 * metadata at runtime, so the source and bundled entry paths agree. Invalid
 * commands or flags, malformed command arguments, and missing option values
 * write plain-text usage to stderr and exit 2 without a report envelope.
 *
 * For each valid non-MCP command, this layer creates one `AbortController`,
 * aborting it when `SIGINT` or `SIGTERM` arrives, and passes its signal with
 * the parsed input to the matching runtime command. MCP owns those signals
 * in its runtime shutdown state machine. Runtime returns an envelope and
 * selected exit code; `--json` writes the `JSON.stringify(envelope)` payload
 * to the stream with a trailing newline appended at the write call, while human
 * output renders that same envelope with ANSI styling disabled by
 * `--no-color`. After output has been written, this
 * module sets the selected process exit code and lets Node exit naturally once
 * pending stream writes have drained. The `heal` subcommand follows that same
 * parse, dispatch, and render boundary as generate, run, and check; its
 * confirmation and persistence policy belong to runtime composition rather
 * than requiring a second top-level CLI shape.
 * MCP deadline expiry is the sole exception: after a bounded attempt to flush
 * both output streams, it exits explicitly so unsettled runtime work cannot
 * keep the process alive.
 *
 * The `view` subcommand accepts no positional paths or JSON report mode. Its
 * parser rejects positionals as `view takes no arguments.` before classifying
 * unknown options, so a stray path gets the command's specific usage error.
 * After dispatch, view keeps the server alive until its signal closes it;
 * its own AmbercastError catch writes the error message and exit code directly,
 * outside the report envelope and the generic unexpected-crash catch.
 *
 * The parser stays hand-written because the small fixed flag surface needs no
 * dependency or a second command grammar. View's server adapter is the narrow
 * exception to this layer's runtime-only imports; configuration, provider
 * selection, errors, and report construction remain on the composition side
 * of that boundary.
 */
import { runGenerateCommand } from '#runtime/generate-command.js';
import { runCheckCommand } from '#runtime/check-command.js';
import { CLI_MANIFEST, flagLookup, renderUsage } from '#runtime/cli-manifest.js';
import { escapeControlChars, escapeStackControlChars } from '#runtime/control-chars.js';
import { readDebugEnvironment } from '#runtime/debug-environment.js';
import { runHealCommand, type HealCommandInput } from '#runtime/heal-command.js';
import { runInitCommand, type InitCommandDeps, type InitCommandInput, type InitCommandOutput } from '#runtime/init-command.js';
import { runMcpCommand } from '#runtime/mcp-command.js';
import { runRunCommand } from '#runtime/run-command.js';
import { AmbercastError, prepareViewCommand, VIEW_COPY } from '#runtime/view-command.js';
import { startLocalReportServer } from '#adapters/http/local-report-server.js';

interface ParsedGenerateCommand {
  readonly command: 'generate';
  readonly input: {
    readonly files: readonly string[];
    readonly strict: boolean;
    readonly force: boolean;
    readonly dryRun: boolean;
    readonly target?: string;
    readonly aiProviderOverride?: 'claude' | 'codex';
    readonly allowEmpty: boolean;
    readonly list: boolean;
    readonly configPathOverride?: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  };
  readonly json: boolean;
  readonly color: boolean;
}

interface ParsedRunCommand {
  readonly command: 'run';
  readonly input: {
    readonly files: readonly string[];
    readonly grep?: RegExp;
    readonly headed: boolean;
    /** Whether the caller explicitly permits AI resolution after a grounding miss. */
    readonly resolve: boolean;
    readonly updateCache: boolean;
    /**
     * Whether a zero-match replay selection is an allowed empty outcome.
     *
     * This stays explicit in parsed input so report policy is independent of
     * command rendering and cannot suppress a matched case's real failure.
     */
    readonly allowEmpty: boolean;
    /**
     * Whether the command reports resolved paths without replaying cases.
     *
     * Runtime forwards the parsed choice to both selection and report
     * construction so list mode has the same contract in text and JSON output.
     */
    readonly list: boolean;
    readonly stale: 'fail' | 'regenerate';
    readonly aiProviderOverride?: 'claude' | 'codex';
    readonly cwd: string;
    readonly signal: AbortSignal;
  };
  readonly json: boolean;
  readonly color: boolean;
}

interface ParsedCheckCommand {
  readonly command: 'check';
  readonly input: {
    readonly files: readonly string[];
    readonly allowEmpty: boolean;
    readonly list: boolean;
    readonly configPathOverride?: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  };
  readonly json: boolean;
  readonly color: boolean;
}

interface ParsedHealCommand {
  readonly command: 'heal';
  readonly input: Omit<HealCommandInput, 'stderr'> & { readonly signal: AbortSignal };
  readonly json: boolean;
  readonly color: boolean;
}

interface ParsedInitCommand {
  readonly command: 'init';
  readonly input: Omit<InitCommandInput, 'stderr'> & { readonly signal: AbortSignal };
  readonly color: boolean;
}

interface ParsedViewCommand {
  readonly command: 'view';
  readonly input: {
    readonly port?: number;
    readonly host?: string;
    readonly allowHeadless: boolean;
    readonly configPathOverride?: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  };
  readonly color: boolean;
}

interface ParsedMcpCommand {
  readonly command: 'mcp';
  readonly dir: string;
  readonly syncWaitMs: number;
  readonly stdin: NodeJS.ReadableStream;
}

const USAGE = renderUsage(CLI_MANIFEST);

/*
 * Human rendering remains command-agnostic: only known healthy states are
 * green. A skipped row records work with no execution or inspection evidence,
 * so green styling would misrepresent the command outcome. An unknown status
 * also defaults to failure styling, preventing a report vocabulary extension
 * from acquiring success styling accidentally.
 */
const HEALTHY_REPORT_STATUSES = new Set(['generated', 'skipped-fresh', 'listed', 'fresh', 'fresh-without-grounding', 'passed']);

/**
 * Maps ReportError codes to the details fields the human renderer shows in
 * schema declaration order. It is the human renderer's internal registry and
 * test seam rather than a schema authority. Every ReportError code that
 * declares a `details` branch in `src/report/schema.ts` needs an entry because
 * the renderer uses this table to choose its renderable fields; without one,
 * no fields are renderable for that error. The secret-policy entries retain
 * names, locations, and environment spellings but never values, matching the
 * report schemas' remediation-only evidence boundary.
 */
export const ERROR_DETAILS_KEY_ORDER: Readonly<Record<string, readonly string[]>> = {
  EXECUTOR_UNSUPPORTED: ['target', 'executor', 'reason', 'missing', 'surface'],
  BROWSER_LAUNCH_FAILED: ['reason', 'engine'],
  PROMPT_PATH_INVALID: ['path', 'reason'],
  AI_RESPONSE_INVALID: ['issues', 'attempts'],
  SECRET_LITERAL_REJECTED: ['detector', 'path', 'attempts'],
  SECRET_ENV_VAR_COLLISION: ['envVar', 'refs'],
  SECRET_CONSENT_REQUIRED: ['reason', 'secrets'],
  SECRET_SYNTAX_REJECTED: ['occurrences'],
  AI_EXECUTOR_UNAVAILABLE: ['attempts'],
  UNEXPECTED_CRASH: ['cause'],
  FS_IO_ERROR: ['partiallyWritten'],
  GROUNDING_UNRESOLVED: ['stepId', 'reason'],
};

/**
 * Fixed warning that `main()` writes to stderr exactly once when a run
 * envelope's `reportPersistence` is `'failed'`, in both JSON and human-rendered
 * modes.
 *
 * @remarks
 * The classification-only wording embeds `FS_IO_ERROR` while excluding
 * interpolated host paths and raw errors, preserving the host-path
 * non-disclosure invariant.
 */
export const REPORT_PERSISTENCE_FAILED_WARNING = 'Warning: the run report could not be written to disk (FS_IO_ERROR); results above reflect this invocation only.';

function writeUsage(stream: NodeJS.WritableStream): void {
  stream.write(USAGE);
}

function colorize(value: string, color: string, enabled: boolean): string {
  return enabled ? `\u001B[${color}m${value}\u001B[0m` : value;
}

/**
 * Formats structured diagnostic details in each code's declared key order.
 *
 * A fixed per-code key-order table follows each `details` sub-schema's field
 * order. `issues` renders each entry as `<code> @ <JSON.stringify(path)>`,
 * joined by `; `. Every other field renders as `key=value`: primitives are
 * stringified, and arrays or objects use compact `JSON.stringify` output.
 * The whole rendered string, including every JSON serialization result, goes
 * through {@link escapeControlChars} before return. There is no JSON carve-out
 * because JSON encoding does not escape DEL or C1 control characters.
 */
function formatErrorDetails(code: unknown, details: unknown): string {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    return '';
  }

  const detailRecord = details as Record<string, unknown>;
  const fields = typeof code === 'string' && Object.hasOwn(ERROR_DETAILS_KEY_ORDER, code)
    ? ERROR_DETAILS_KEY_ORDER[code]!
    : [];

  return fields
    .filter((key) => Object.hasOwn(detailRecord, key))
    .map((key) => {
      const value = detailRecord[key];
      if (key === 'issues' && Array.isArray(value)) {
        const issues = value.map((issue) => {
          if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
            return escapeControlChars(String(issue));
          }
          const issueRecord = issue as Record<string, unknown>;
          return `${escapeControlChars(String(issueRecord.code ?? ''))} @ ${escapeControlChars(JSON.stringify(issueRecord.path))}`;
        }).join('; ');
        return `issues=${issues}`;
      }
      const rendered = value !== null && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
      return `${key}=${escapeControlChars(rendered)}`;
    })
    .join('; ');
}

/**
 * Projects a trusted caught error to the CLI's stable cause vocabulary.
 *
 * The crash boundary avoids exposing implementation-specific classes and must
 * remain operable for hostile caught values, so it uses the generic category
 * whenever identity cannot be established safely.
 */
function projectCauseName(cause: unknown): string {
  try {
    if (!(cause instanceof Error)) {
      return 'Error';
    }
    const name = cause.name;
    return name === 'Error' || name === 'TypeError' || name === 'RangeError'
      || name === 'SyntaxError' || name === 'ReferenceError' || name === 'AbortError' || name === 'TimeoutError'
      ? name
      : 'Error';
  } catch {
    return 'Error';
  }
}

/**
 * Renders a report-shaped value as compact terminal lines.
 *
 * @param envelope - The runtime report or an unexpected non-report value.
 * @param color - Whether ANSI color sequences are enabled.
 * @returns Human-readable result and error lines with a final newline when
 * any line exists.
 * @remarks
 * Status styling is data-driven for every command except heal. Completed heal
 * rows always have the same status, so their healthy styling must follow both
 * the repair outcome and settled application state. Partially healed and
 * unresolved rows remain unhealthy regardless of application; otherwise,
 * applied, preview-only, and no-artifact-change are healthy. The renderer appends a result's optional `reason`; check supplies only its fixed,
 * path-free reason. The displayed identity comes from `file`, falling back to
 * `id` when `file` is absent, and never from `groundingFile` or `artifactFile`,
 * so artifact evidence cannot be rendered as an explanatory host path. A `skipped` row has no reason or artifact evidence
 * and retains the generic non-healthy styling.
 *
 * The `file`/`id`, `reason`, and error `message` values written to this output
 * have C0, DEL, and C1 control characters replaced with a JSON-style
 * visible-escape form because they may originate in untrusted filesystem paths
 * or free text; literal backslashes are preserved unescaped. This does not
 * affect the `status` column or the JSON output path. Stage 3 secret-set
 * rejection adds one result-local remediation line
 * immediately after its row, rather than entering the error channel: healing
 * must leave artifacts unchanged until regeneration receives fresh consent
 * (SPEC-C3-2).
 */
export function renderHumanReport(
  envelope: Awaited<ReturnType<typeof runRunCommand>>['envelope'],
  color: boolean,
): string {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return `${String(envelope)}\n`;
  }

  const report = envelope as Record<string, unknown>;
  const results = Array.isArray(report.results) ? report.results : [];
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const lines = results.flatMap((result) => {
    const item = result as Record<string, unknown> & {
      readonly stage3Rejection?: { readonly reason?: unknown };
    };
    const status = String(item.status ?? 'unknown');
    const healApplication = report.command === 'heal' && typeof item.application === 'string'
      ? item.application
      : undefined;
    const healRepairOutcome = report.command === 'heal' && typeof item.repairOutcome === 'string'
      ? item.repairOutcome
      : undefined;
    const healthy = healApplication === undefined
      ? HEALTHY_REPORT_STATUSES.has(status)
      : healRepairOutcome !== 'partially-healed'
        && healRepairOutcome !== 'unresolved'
        && (healApplication === 'applied' || healApplication === 'preview-only' || healApplication === 'no-artifact-change');
    const statusColor = healthy ? '32' : status === 'would-generate' ? '33' : '31';
    const reason = typeof item.reason === 'string' ? `: ${escapeControlChars(item.reason)}` : '';
    const row = `${colorize(status, statusColor, color)} ${escapeControlChars(String(item.file ?? item.id ?? ''))}${reason}`.trimEnd();
    return item.stage3Rejection?.reason === 'secret-set-changed'
      ? [row, `  hint: 秘匿値の構成が変わった。ambercast generate --force ${escapeControlChars(String(item.file ?? item.id ?? ''))} で再生成し同意を取り直す`]
      : [row];
  });

  for (const error of errors) {
    const item = error as Record<string, unknown>;
    const code = typeof item.code === 'string' ? item.code : undefined;
    if (code === undefined) {
      lines.push(`${colorize('error', '31', color)} ${escapeControlChars(String(item.message ?? 'Unknown error'))}`);
      continue;
    }
    const caseId = typeof item.caseId === 'string' ? ` [${escapeControlChars(item.caseId)}]` : '';
    lines.push(`${colorize('error', '31', color)} ${code}${caseId}: ${escapeControlChars(String(item.message ?? 'Unknown error'))}`);
    if (typeof item.hint === 'string') {
      lines.push(`  hint: ${escapeControlChars(item.hint)}`);
    }
    // A details object does not guarantee renderable diagnostics; an empty label
    // would misleadingly suggest that no diagnostic information exists.
    if (item.details !== undefined) {
      const formattedDetails = formatErrorDetails(code, item.details);
      if (formattedDetails.length > 0) {
        lines.push(`  details: ${formattedDetails}`);
      }
    }
  }

  return `${lines.join('\n')}${lines.length === 0 ? '' : '\n'}`;
}

/**
 * Command-local lookup precedes generic token classification across the
 * parsers. That ordering keeps unregistered single-hyphen tokens usable as
 * literal paths through the positional fallback while declared aliases resolve
 * through their canonical descriptors before long-option rejection. This is a
 * compatibility invariant that types cannot enforce.
 *
 */
function parseGenerate(argv: readonly string[], signal: AbortSignal): ParsedGenerateCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  const files: string[] = [];
  let strict = false;
  let force = false;
  let dryRun = false;
  let target: string | undefined;
  let aiProviderOverride: 'claude' | 'codex' | undefined;
  let allowEmpty = false;
  let list = false;
  let json = false;
  let configPathOverride: string | undefined;
  let color = true;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'generate')!);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') {
      files.push(...argv.slice(index + 1));
      break;
    }
    const flag = flags.get(argument);
    if (flag !== undefined) {
      if (flag.value === null) {
        if (flag.name === 'strict') {
          strict = true;
        } else if (flag.name === 'force') {
          force = true;
        } else if (flag.name === 'dry-run') {
          dryRun = true;
        } else if (flag.name === 'allow-empty') {
          allowEmpty = true;
        } else if (flag.name === 'list') {
          list = true;
        } else if (flag.name === 'json') {
          json = true;
        } else if (flag.name === 'no-color') {
          color = false;
        }
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return `Missing value for ${argument}.`;
        }

        index += 1;
        if (flag.acceptedValues !== null && !flag.acceptedValues.includes(value)) {
          return `The ${argument} value must be ${flag.acceptedValues.join(' or ')}.`;
        }
        if (flag.name === 'target') {
          target = value;
        } else if (flag.name === 'config') {
          configPathOverride = value;
        } else if (flag.name === 'ai') {
          aiProviderOverride = value as 'claude' | 'codex';
        }
      }
      continue;
    }
    if (!argument.startsWith('--')) {
      files.push(argument);
      continue;
    }

    return `Unknown generate option: ${argument}.`;
  }

  return {
    command: 'generate',
    input: {
      files,
      strict,
      force,
      dryRun,
      ...(target === undefined ? {} : { target }),
      ...(aiProviderOverride === undefined ? {} : { aiProviderOverride }),
      allowEmpty,
      list,
      ...(configPathOverride === undefined ? {} : { configPathOverride }),
      cwd: process.cwd(),
      signal,
    },
    json,
    color,
  };
}

/**
 * `--grep` is compiled at the CLI boundary, so malformed expressions remain
 * argument-shape errors and use CLI usage reporting instead of becoming
 * runtime configuration failures. `--resolve` is deliberately an explicit
 * opt-in, so its absence reaches runtime as fail-closed replay policy.
 */
function parseRun(argv: readonly string[], signal: AbortSignal): ParsedRunCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  const files: string[] = [];
  let grep: RegExp | undefined;
  let headed = false;
  let json = false;
  let resolve = false;
  let updateCache = false;
  let allowEmpty = false;
  let list = false;
  let stale: 'fail' | 'regenerate' = 'fail';
  let aiProviderOverride: 'claude' | 'codex' | undefined;
  let color = true;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'run')!);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') {
      files.push(...argv.slice(index + 1));
      break;
    }
    const flag = flags.get(argument);
    if (flag !== undefined) {
      if (flag.value === null) {
        if (flag.name === 'headed') {
          headed = true;
        } else if (flag.name === 'allow-empty') {
          allowEmpty = true;
        } else if (flag.name === 'list') {
          list = true;
        } else if (flag.name === 'json') {
          json = true;
        } else if (flag.name === 'resolve') {
          resolve = true;
        } else if (flag.name === 'update-cache') {
          updateCache = true;
        } else if (flag.name === 'no-color') {
          color = false;
        }
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return `Missing value for ${argument}.`;
        }

        index += 1;
        if (flag.acceptedValues !== null && !flag.acceptedValues.includes(value)) {
          return `The ${argument} value must be ${flag.acceptedValues.join(' or ')}.`;
        }
        if (flag.name === 'grep') {
          try {
            grep = new RegExp(value);
          } catch {
            return 'The --grep value must be a valid regular expression.';
          }
        } else if (flag.name === 'stale') {
          stale = value as 'fail' | 'regenerate';
        } else if (flag.name === 'ai') {
          aiProviderOverride = value as 'claude' | 'codex';
        }
      }
      continue;
    }
    if (!argument.startsWith('--')) {
      files.push(argument);
      continue;
    }

    return `Unknown run option: ${argument}.`;
  }

  return {
    command: 'run',
    input: {
      files,
      ...(grep === undefined ? {} : { grep }),
      headed,
      resolve,
      updateCache,
      allowEmpty,
      list,
      stale,
      ...(aiProviderOverride === undefined ? {} : { aiProviderOverride }),
      cwd: process.cwd(),
      signal,
    },
    json,
    color,
  };
}

/**
 * Check keeps a read-only option surface so freshness inspection cannot
 * accidentally acquire generation or replay controls.
 */
function parseCheck(argv: readonly string[], signal: AbortSignal): ParsedCheckCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  const files: string[] = [];
  let allowEmpty = false;
  let list = false;
  let json = false;
  let configPathOverride: string | undefined;
  let color = true;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'check')!);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') {
      files.push(...argv.slice(index + 1));
      break;
    }
    const flag = flags.get(argument);
    if (flag !== undefined) {
      if (flag.value === null) {
        if (flag.name === 'allow-empty') {
          allowEmpty = true;
        } else if (flag.name === 'list') {
          list = true;
        } else if (flag.name === 'json') {
          json = true;
        } else if (flag.name === 'no-color') {
          color = false;
        }
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return `Missing value for ${argument}.`;
        }

        index += 1;
        if (flag.acceptedValues !== null && !flag.acceptedValues.includes(value)) {
          return `The ${argument} value must be ${flag.acceptedValues.join(' or ')}.`;
        }
        if (flag.name === 'config') {
          configPathOverride = value;
        }
      }
      continue;
    }
    if (!argument.startsWith('--')) {
      files.push(argument);
      continue;
    }

    return `Unknown check option: ${argument}.`;
  }

  return {
    command: 'check',
    input: {
      files,
      allowEmpty,
      list,
      ...(configPathOverride === undefined ? {} : { configPathOverride }),
      cwd: process.cwd(),
      signal,
    },
    json,
    color,
  };
}

/** MCP owns its process signals after argument validation, so this parser only selects streams and policy. */
function parseMcp(argv: readonly string[], _signal: AbortSignal): ParsedMcpCommand | string {
  if (argv.includes('--help')) return 'help';

  let dir = process.cwd();
  let syncWaitMs = 45_000;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'mcp')!);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const flag = flags.get(argument);
    if (flag !== undefined) {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        return `Missing value for ${argument}.`;
      }
      index += 1;
      if (flag.name === 'dir') {
        dir = value;
      } else if (flag.name === 'sync-wait-ms') {
        const parsed = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
          return `The ${argument} value must be a positive integer.`;
        }
        syncWaitMs = parsed;
      }
      continue;
    }
    return argument.startsWith('-') ? `Unknown mcp option: ${argument}.` : `Unexpected mcp argument: ${argument}.`;
  }

  return { command: 'mcp', dir, syncWaitMs, stdin: process.stdin };
}

function parseHeal(argv: readonly string[], signal: AbortSignal): ParsedHealCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  const files: string[] = [];
  let dryRun = false;
  let yes = false;
  let aiProviderOverride: 'claude' | 'codex' | undefined;
  let allowEmpty = false;
  let list = false;
  let json = false;
  let color = true;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'heal')!);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') {
      files.push(...argv.slice(index + 1));
      break;
    }
    const flag = flags.get(argument);
    if (flag !== undefined) {
      if (flag.value === null) {
        if (flag.name === 'dry-run') {
          dryRun = true;
        } else if (flag.name === 'yes') {
          yes = true;
        } else if (flag.name === 'allow-empty') {
          allowEmpty = true;
        } else if (flag.name === 'list') {
          list = true;
        } else if (flag.name === 'json') {
          json = true;
        } else if (flag.name === 'no-color') {
          color = false;
        }
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return `Missing value for ${argument}.`;
        }

        index += 1;
        if (flag.acceptedValues !== null && !flag.acceptedValues.includes(value)) {
          return `The ${argument} value must be ${flag.acceptedValues.join(' or ')}.`;
        }
        if (flag.name === 'ai') {
          aiProviderOverride = value as 'claude' | 'codex';
        }
      }
      continue;
    }
    if (!argument.startsWith('--')) {
      files.push(argument);
      continue;
    }

    return `Unknown heal option: ${argument}.`;
  }

  return {
    command: 'heal',
    input: {
      files,
      dryRun,
      yes,
      ...(aiProviderOverride === undefined ? {} : { aiProviderOverride }),
      allowEmpty,
      list,
      cwd: process.cwd(),
      signal,
    },
    json,
    color,
  };
}

/**
 * Parses init's intentionally narrow, non-positional flag grammar.
 *
 * A declared value flag consumes its next token before token classification,
 * preserving the command-local parser convention that `--dir -y` names a
 * directory literally rather than enabling confirmation bypass.
 */
function parseInit(argv: readonly string[], signal: AbortSignal): ParsedInitCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  let dir: string | undefined;
  let yes = false;
  let force = false;
  let color = true;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'init')!);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') {
      const positional = argv[index + 1];
      return positional === undefined
        ? {
            command: 'init',
            input: { dir, yes, force, cwd: process.cwd(), signal },
            color,
          }
        : `Unknown init option: ${positional}.`;
    }
    const flag = flags.get(argument);
    if (flag !== undefined) {
      if (flag.value === null) {
        if (flag.name === 'yes') {
          yes = true;
        } else if (flag.name === 'force') {
          force = true;
        } else if (flag.name === 'no-color') {
          color = false;
        }
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return `Missing value for ${argument}.`;
        }
        index += 1;
        if (flag.name === 'dir') {
          dir = value;
        }
      }
      continue;
    }
    return `Unknown init option: ${argument}.`;
  }

  return {
    command: 'init',
    input: { dir, yes, force, cwd: process.cwd(), signal },
    color,
  };
}

/**
 * Parses view's non-positional flags, leaving bind and terminal policy to the
 * runtime and HTTP layers. Port syntax is validated here so malformed input
 * follows the ordinary usage-error path before any server work begins.
 */
function parseView(argv: readonly string[], signal: AbortSignal): ParsedViewCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  let port: number | undefined;
  let host: string | undefined;
  let allowHeadless = false;
  let configPathOverride: string | undefined;
  let color = true;
  const flags = flagLookup(CLI_MANIFEST.commands.find((command) => command.name === 'view')!);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--') {
      return argv[index + 1] === undefined ? {
        command: 'view',
        input: {
          ...(port === undefined ? {} : { port }),
          ...(host === undefined ? {} : { host }),
          allowHeadless,
          ...(configPathOverride === undefined ? {} : { configPathOverride }),
          cwd: process.cwd(),
          signal,
        },
        color,
      } : 'view takes no arguments.';
    }
    const flag = flags.get(argument);
    if (flag !== undefined) {
      if (flag.value === null) {
        if (flag.name === 'allow-headless') allowHeadless = true;
        else if (flag.name === 'no-color') color = false;
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return `Missing value for ${argument}.`;
        }
        index += 1;
        if (flag.name === 'port') {
          if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
            return 'The --port value must be an integer from 1 to 65535.';
          }
          port = Number(value);
        } else if (flag.name === 'host') {
          host = value;
        } else if (flag.name === 'config') {
          configPathOverride = value;
        }
      }
      continue;
    }
    if (!argument.startsWith('--')) return 'view takes no arguments.';
    return `Unknown view option: ${argument}.`;
  }

  return {
    command: 'view',
    input: {
      ...(port === undefined ? {} : { port }),
      ...(host === undefined ? {} : { host }),
      allowHeadless,
      ...(configPathOverride === undefined ? {} : { configPathOverride }),
      cwd: process.cwd(),
      signal,
    },
    color,
  };
}

/**
 * Renders the init result protocol without projecting it into a report envelope.
 *
 * Init owns a fixed artifact list and human-oriented next step, so its output
 * remains a separate public contract from the structured report renderers.
 */
export function renderInitOutput(output: InitCommandOutput): { stdout: string } {
  const rows = output.states.map((state) => `  ${state.state.padEnd(14)}${escapeControlChars(state.path)}`);
  if (output.outcome === 'declined') {
    return { stdout: 'Nothing written.\n' };
  }
  if (output.outcome === 'nothing-to-do') {
    return { stdout: `${rows.join('\n')}\nNothing to do.\n` };
  }
  if (output.outcome === 'written') {
    return {
      stdout: `${rows.join('\n')}\n\nNext: start your app at http://localhost:3000, then run\n  npx ambercast generate tests/ambercast/find-page.test.md\nUsing Claude Code? Add \`@AGENTS.md\` to CLAUDE.md so it reads the ambercast section.\n`,
    };
  }
  return { stdout: rows.length === 0 ? '' : `${rows.join('\n')}\n` };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
  initDeps?: Partial<InitCommandDeps>,
): Promise<void> {
  if (argv.length === 0) {
    writeUsage(stdout);
    process.exitCode = 0;
    return;
  }

  if (argv[0] === '--version') {
    stdout.write(`ambercast v${__VERSION__}\n`);
    process.exitCode = 0;
    return;
  }
  if (argv[0] === '--help') {
    writeUsage(stdout);
    process.exitCode = 0;
    return;
  }
  if (
    argv[0] !== 'init'
    && argv[0] !== 'generate'
    && argv[0] !== 'run'
    && argv[0] !== 'check'
    && argv[0] !== 'heal'
    && argv[0] !== 'view'
    && argv[0] !== 'mcp'
  ) {
    stderr.write(`Unknown command: ${argv[0]}.\n`);
    writeUsage(stderr);
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const parsed = argv[0] === 'init'
    ? parseInit(argv.slice(1), controller.signal)
    : argv[0] === 'generate'
      ? parseGenerate(argv.slice(1), controller.signal)
      : argv[0] === 'run'
        ? parseRun(argv.slice(1), controller.signal)
        : argv[0] === 'check'
          ? parseCheck(argv.slice(1), controller.signal)
          : argv[0] === 'view'
            ? parseView(argv.slice(1), controller.signal)
            : argv[0] === 'mcp'
              ? parseMcp(argv.slice(1), controller.signal)
              : parseHeal(argv.slice(1), controller.signal);
  if (typeof parsed === 'string') {
    if (parsed === 'help') {
      writeUsage(stdout);
      process.exitCode = 0;
      return;
    }

    stderr.write(`${parsed}\n`);
    writeUsage(stderr);
    process.exitCode = 2;
    return;
  }

  const abort = (signal: NodeJS.Signals): void => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Received ${signal}.`));
    }
  };
  const onSigint = (): void => abort('SIGINT');
  const onSigterm = (): void => abort('SIGTERM');
  if (parsed.command !== 'mcp') {
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  }

  try {
    try {
      if (parsed.command === 'init') {
        const initInput = { ...parsed.input, stderr };
        const output = initDeps === undefined
          ? await runInitCommand(initInput)
          : await runInitCommand(initInput, initDeps);
        stdout.write(renderInitOutput(output).stdout);
        if (output.message !== null) {
          stderr.write(`${output.message}\n`);
        }
        process.exitCode = output.exitCode;
        return;
      }
      if (parsed.command === 'view') {
        try {
          const plan = await prepareViewCommand({ ...parsed.input, stderr });
          const { url, closed } = await startLocalReportServer(plan, {
            signal: parsed.input.signal,
            stderr,
          });
          if (url !== '') {
            const host = new URL(url).host;
            stderr.write(`${VIEW_COPY.cli.startupPrefix}${host}${VIEW_COPY.cli.startupSuffix}\n`);
            if (plan.warn) {
              stderr.write(`${VIEW_COPY.cli.warningPrefix}${host}${VIEW_COPY.cli.warningSuffix}\n`);
            }
          }
          await closed;
          process.exitCode = 0;
        } catch (error) {
          if (error instanceof AmbercastError) {
            stderr.write(`${error.message}\n`);
            process.exitCode = error.exitCode;
            return;
          }
          throw error;
        }
        return;
      }
      const output = parsed.command === 'generate'
        ? await runGenerateCommand({ ...parsed.input, stderr })
        : parsed.command === 'run'
          ? await runRunCommand({ ...parsed.input, stderr })
          : parsed.command === 'check'
            ? await runCheckCommand({ ...parsed.input, stderr })
            : parsed.command === 'mcp'
              ? await (async () => {
                const exitCode = await runMcpCommand({ dir: parsed.dir, syncWaitMs: parsed.syncWaitMs, stdin: parsed.stdin, stdout, stderr });
                /**
                 * A timed-out MCP drain can leave live runtime work that would
                 * keep Node alive, so this is the sole explicit exit boundary.
                 * Give pending diagnostics a bounded chance to flush without
                 * letting absent diagnostics or broken streams change the exit
                 * outcome. Failed writes count as settled to avoid a second
                 * crash while shutting down.
                 */
                process.exitCode = exitCode;
                if (exitCode === 3) {
                  const flush = (stream: NodeJS.WritableStream): Promise<void> => new Promise((resolveFlush) => {
                    try {
                      stream.write('', () => resolveFlush());
                    } catch {
                      resolveFlush();
                    }
                  });
                  let timeout: ReturnType<typeof setTimeout> | undefined;
                  const deadline = new Promise<void>((resolveDeadline) => {
                    timeout = setTimeout(resolveDeadline, 1_000);
                  });
                  await Promise.race([Promise.all([flush(stdout), flush(stderr)]), deadline]);
                  if (timeout !== undefined) clearTimeout(timeout);
                  process.exit(3);
                }
                return { exitCode, envelope: null };
              })()
              : await runHealCommand({ ...parsed.input, stderr });
      if (
        output.envelope !== null
        && parsed.command === 'run'
        && output.envelope.command === 'run'
        && output.envelope.reportPersistence === 'failed'
      ) {
        stderr.write(`${REPORT_PERSISTENCE_FAILED_WARNING}\n`);
      }
      if (output.envelope !== null) {
        stdout.write((parsed as { json?: boolean; color?: boolean }).json ? `${JSON.stringify(output.envelope)}\n` : renderHumanReport(output.envelope, (parsed as { color?: boolean }).color ?? true));
        process.exitCode = output.exitCode;
      }
    } catch (error) {
      /*
       * Opt-in diagnostics can contain sensitive data, but unavailable or
       * hostile properties must never replace the original failure with a
       * second crash in this last-resort reporting path.
       */
      const name = projectCauseName(error);
      stderr.write(`The ${parsed.command} command crashed unexpectedly (${name}). Set AMBERCAST_DEBUG=1 to print the message and stack; they may contain sensitive data.\n`);
      if (readDebugEnvironment()) {
        try {
          const message = error !== null && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
          if (typeof message === 'string') stderr.write(`cause message: ${escapeControlChars(message)}\n`);
        } catch {}
        try {
          const stack = error !== null && typeof error === 'object' ? (error as { stack?: unknown }).stack : undefined;
          if (typeof stack === 'string') stderr.write(`cause stack:\n${escapeStackControlChars(stack)}\n`);
        } catch {}
      }
      process.exitCode = 3;
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}
