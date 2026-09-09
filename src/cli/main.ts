/**
 * Parses CLI arguments, delegates parsed generate, run, check, and heal commands to
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
 * For each valid command, this layer creates one `AbortController`, aborting
 * it when `SIGINT` or `SIGTERM` arrives, and passes its signal with the parsed
 * input to the matching runtime command. Runtime returns an envelope and
 * selected exit code; `--json` writes the `JSON.stringify(envelope)` payload
 * to the stream with a trailing newline appended at the write call, while human
 * output renders that same envelope with ANSI styling disabled by
 * `--no-color`. After output has been written, this
 * module sets the selected process exit code and lets Node exit naturally once
 * pending stream writes have drained. The `heal` subcommand follows that same
 * parse, dispatch, and render boundary as generate, run, and check; its
 * confirmation and persistence policy belong to runtime composition rather
 * than requiring a second top-level CLI shape.
 *
 * The parser stays hand-written because the small fixed flag surface needs no
 * dependency or a second command grammar. This layer imports only runtime:
 * configuration, provider selection, errors, and report construction remain
 * on the composition side of that boundary.
 */
import { runGenerateCommand } from '#runtime/generate-command.js';
import { runCheckCommand } from '#runtime/check-command.js';
import { CLI_MANIFEST, flagLookup, renderUsage } from '#runtime/cli-manifest.js';
import { readDebugEnvironment } from '#runtime/debug-environment.js';
import { runHealCommand, type HealCommandInput } from '#runtime/heal-command.js';
import { runRunCommand } from '#runtime/run-command.js';

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
    readonly target?: string;
    readonly headed: boolean;
    readonly cacheOnly: boolean;
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
    readonly target?: string;
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
 * no fields are renderable for that error.
 */
export const ERROR_DETAILS_KEY_ORDER: Readonly<Record<string, readonly string[]>> = {
  PROMPT_PATH_INVALID: ['path', 'reason'],
  AI_RESPONSE_INVALID: ['issues', 'attempts'],
  SECRET_LITERAL_REJECTED: ['detector', 'path', 'attempts'],
  SECRET_GRANT_UNATTRIBUTABLE: ['reason', 'secretRef', 'stepId', 'sourceSpan', 'attempts'],
  AI_EXECUTOR_UNAVAILABLE: ['attempts'],
  UNEXPECTED_CRASH: ['cause'],
  FS_IO_ERROR: ['partiallyWritten'],
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
 * Escapes C0 controls (0x00–0x1F), DEL (0x7F), and C1 controls (0x80–0x9F)
 * into display-safe visible forms. Backspace, tab, newline, form feed, and
 * carriage return use JSON's short escapes; every other affected value uses
 * a backslash, the letter u, and four lowercase hexadecimal digits.
 *
 * A literal backslash remains unescaped to favor readability over round-trip
 * safety. This display-time transform prevents untrusted filesystem-derived
 * strings from injecting terminal control sequences and never applies to
 * `--json` output.
 *
 * Only these three ranges change; everything else passes through byte-for-byte.
 */
function escapeControlChars(value: string): string {
  let escaped = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08:
        escaped += '\\b';
        break;
      case 0x09:
        escaped += '\\t';
        break;
      case 0x0a:
        escaped += '\\n';
        break;
      case 0x0c:
        escaped += '\\f';
        break;
      case 0x0d:
        escaped += '\\r';
        break;
      default:
        if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
          escaped += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          escaped += value[index]!;
        }
    }
  }

  return escaped;
}

function escapeStackControlChars(value: string): string {
  return value.split(/(\r\n|\r|\n)/u)
    .map((part) => part === '\r\n' || part === '\r' || part === '\n' ? part : escapeControlChars(part))
    .join('');
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
  const fields = ERROR_DETAILS_KEY_ORDER[typeof code === 'string' ? code : ''] ?? [];

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
 * affect the `status` column or the JSON output path.
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
  const lines = results.map((result) => {
    const item = result as Record<string, unknown>;
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
    return `${colorize(status, statusColor, color)} ${escapeControlChars(String(item.file ?? item.id ?? ''))}${reason}`.trimEnd();
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
 * runtime configuration failures.
 */
function parseRun(argv: readonly string[], signal: AbortSignal): ParsedRunCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  const files: string[] = [];
  let grep: RegExp | undefined;
  let target: string | undefined;
  let headed = false;
  let json = false;
  let cacheOnly = false;
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
        } else if (flag.name === 'cache-only') {
          cacheOnly = true;
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
        } else if (flag.name === 'target') {
          target = value;
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
      ...(target === undefined ? {} : { target }),
      headed,
      cacheOnly,
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
  let target: string | undefined;
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
        if (flag.name === 'target') {
          target = value;
        } else if (flag.name === 'config') {
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
      ...(target === undefined ? {} : { target }),
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

function parseHeal(argv: readonly string[], signal: AbortSignal): ParsedHealCommand | string {
  const separator = argv.indexOf('--');
  if (argv.slice(0, separator === -1 ? undefined : separator).includes('--help')) {
    return 'help';
  }

  const files: string[] = [];
  let dryRun = false;
  let yes = false;
  let target: string | undefined;
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
        if (flag.name === 'target') {
          target = value;
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

    return `Unknown heal option: ${argument}.`;
  }

  return {
    command: 'heal',
    input: {
      files,
      dryRun,
      yes,
      ...(target === undefined ? {} : { target }),
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

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
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
  if (argv[0] !== 'generate' && argv[0] !== 'run' && argv[0] !== 'check' && argv[0] !== 'heal') {
    stderr.write(`Unknown command: ${argv[0]}.\n`);
    writeUsage(stderr);
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const parsed = argv[0] === 'generate'
    ? parseGenerate(argv.slice(1), controller.signal)
    : argv[0] === 'run'
      ? parseRun(argv.slice(1), controller.signal)
      : argv[0] === 'check'
        ? parseCheck(argv.slice(1), controller.signal)
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
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    try {
      const output = parsed.command === 'generate'
        ? await runGenerateCommand({ ...parsed.input, stderr })
        : parsed.command === 'run'
          ? await runRunCommand({ ...parsed.input, stderr })
          : parsed.command === 'check'
            ? await runCheckCommand({ ...parsed.input, stderr })
            : await runHealCommand({ ...parsed.input, stderr });
      if (
        parsed.command === 'run'
        && output.envelope.command === 'run'
        && output.envelope.reportPersistence === 'failed'
      ) {
        stderr.write(`${REPORT_PERSISTENCE_FAILED_WARNING}\n`);
      }
      stdout.write(parsed.json ? `${JSON.stringify(output.envelope)}\n` : renderHumanReport(output.envelope, parsed.color));
      process.exitCode = output.exitCode;
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
