/**
 * Declares the version-independent CLI surface from which help text, accepted
 * flags, and the published CLI manifest are derived.
 *
 * Keeping this data and its pure projections in core prevents the parser,
 * renderer, and schema generator from independently transcribing the same
 * public contract. Its pure projections have no filesystem, process, or
 * provider dependency: runtime composition supplies the version, while the
 * CLI reaches these exports through its runtime facade.
 */

/**
 * Describes one canonical command-line flag and its presentation metadata.
 *
 * The parser uses `value` as the sole value-taking signal and uses a
 * non-null `acceptedValues` set for finite-value validation. Presentation is
 * deliberately separate: `shownValue` can preserve a narrower historical help
 * placeholder without weakening the parser's accepted grammar, and `hidden`
 * can omit an accepted flag from generated help.
 */
export interface CliFlag {
  /** The canonical flag spelling without its leading `--`. */
  readonly name: string;
  /** The optional one-character spelling without its leading `-`. */
  readonly alias: string | null;
  /**
   * The value grammar displayed in the manifest and used to decide whether
   * parsing consumes the following argument; `null` marks a boolean flag.
   */
  readonly value: string | null;
  /** Whether help rendering omits this otherwise accepted flag. */
  readonly hidden: boolean;
  /**
   * The finite accepted grammar, when one exists. This is `null` for both
   * boolean and free-text flags, and otherwise remains non-empty.
   */
  readonly acceptedValues: readonly string[] | null;
  /**
   * An optional help-only substitute for `value`, used where the established
   * output intentionally advertises a narrower placeholder.
   */
  readonly shownValue: string | null;
  /** The reference-documentation description published with the flag. */
  readonly effect: string;
  /** The documented default, or `null` when the flag has no default text. */
  readonly default: string | null;
  /**
   * A deliberate layout boundary after this flag. Explicit boundaries preserve
   * stable help bytes because command-specific wrapping has no reliable
   * general width rule.
   */
  readonly lineBreakAfter: boolean;
}

/**
 * Describes one command's public syntax and its ordered option surface.
 *
 * Command and flag order are data rather than renderer decisions, so the
 * usage text, generated manifest, and parser lookup share the same stable
 * declaration order.
 */
export interface CliCommand {
  /** The command token accepted after `ambercast`. */
  readonly name: string;
  /** The command description shown in the aligned commands block. */
  readonly summary: string;
  /**
   * The optional positional contract. A variadic positional remains distinct
   * from flags so renderers can form command syntax without parser heuristics.
   */
  readonly positional: {
    readonly name: string;
    readonly variadic: boolean;
    readonly description: string;
  } | null;
  /** Flags in their canonical help and manifest order. */
  readonly flags: readonly CliFlag[];
}

/**
 * Represents the complete, versioned public CLI declaration.
 *
 * The version is injected at the build boundary rather than read from package
 * metadata at runtime, preserving the build-time version contract.
 * `helpFooter` remains data because its exact trailing bytes are part of the
 * public `--help` compatibility surface.
 */
export interface CliManifest {
  readonly version: string;
  readonly commands: readonly CliCommand[];
  readonly helpFooter: string;
}

/**
 * Holds the static CLI declaration before a build supplies its version.
 *
 * Separating this from {@link CliManifest} keeps the authored data honest:
 * schema generation can compose the injected `__VERSION__` without storing a
 * fictitious version in the source declaration.
 */
export type VersionlessCliManifest = Omit<CliManifest, 'version'>;

/**
 * Declares the complete versionless public CLI contract.
 *
 * This is the single source read by `renderUsage`, `flagLookup`, and the CLI
 * parsers, so help presentation and accepted syntax cannot drift apart.
 * Whenever `acceptedValues` is non-null, `value` is derived as
 * `` `<${acceptedValues.join('|')}>` ``. `helpFooter` remains here rather
 * than in `main.ts` so the shared configuration vocabulary has one public,
 * byte-stable rendering surface.
 */
export const CLI_MANIFEST: VersionlessCliManifest = {
  commands: [
    {
      name: 'generate',
      summary: 'Generate deterministic plans',
      positional: { name: 'files', variadic: true, description: 'literal prompts; absent selects discovery' },
      flags: [
        { name: 'strict', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'strict generation policy', default: 'false', lineBreakAfter: false },
        { name: 'force', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'force generation', default: 'false', lineBreakAfter: false },
        { name: 'dry-run', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'preview: would-generate only when generation is needed; fresh Plan returns skipped-fresh; neither outcome writes', default: 'false', lineBreakAfter: false },
        { name: 'target', alias: null, value: '<name>', hidden: false, acceptedValues: null, shownValue: null, effect: 'select target', default: 'omitted', lineBreakAfter: false },
        { name: 'ai', alias: null, value: '<claude|codex>', hidden: false, acceptedValues: ['claude', 'codex'], shownValue: null, effect: 'provider override', default: 'omitted', lineBreakAfter: true },
        { name: 'allow-empty', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'allow empty selection', default: 'false', lineBreakAfter: false },
        { name: 'list', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'list without generation', default: 'false', lineBreakAfter: false },
        { name: 'json', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'JSON envelope', default: 'false', lineBreakAfter: false },
        { name: 'config', alias: null, value: '<path>', hidden: false, acceptedValues: null, shownValue: null, effect: 'explicit config', default: 'omitted', lineBreakAfter: false },
        { name: 'no-color', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'disable ANSI', default: 'false', lineBreakAfter: false },
      ],
    },
    {
      name: 'run',
      summary: 'Replay deterministic plans',
      positional: { name: 'files', variadic: true, description: 'literal prompts; absent selects discovery' },
      flags: [
        { name: 'grep', alias: null, value: '<pattern>', hidden: false, acceptedValues: null, shownValue: null, effect: 'RegExp path filter', default: 'omitted', lineBreakAfter: false },
        { name: 'target', alias: null, value: '<name>', hidden: false, acceptedValues: null, shownValue: null, effect: 'select target', default: 'omitted', lineBreakAfter: false },
        { name: 'headed', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'headed browser', default: 'false', lineBreakAfter: false },
        { name: 'cache-only', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'forbid AI fallback', default: 'false', lineBreakAfter: false },
        { name: 'update-cache', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'request cache write', default: 'false', lineBreakAfter: false },
        { name: 'allow-empty', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'allow empty selection', default: 'false', lineBreakAfter: false },
        { name: 'list', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'list without replay', default: 'false', lineBreakAfter: true },
        { name: 'stale', alias: null, value: '<fail|regenerate>', hidden: false, acceptedValues: ['fail', 'regenerate'], shownValue: '<fail>', effect: 'stale policy parser value', default: 'fail', lineBreakAfter: false },
        { name: 'ai', alias: null, value: '<claude|codex>', hidden: false, acceptedValues: ['claude', 'codex'], shownValue: null, effect: 'fallback override', default: 'omitted', lineBreakAfter: false },
        { name: 'json', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'JSON envelope', default: 'false', lineBreakAfter: false },
        { name: 'no-color', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'disable ANSI', default: 'false', lineBreakAfter: false },
      ],
    },
    {
      name: 'check',
      summary: 'Check plan freshness',
      positional: { name: 'files', variadic: true, description: 'literal prompts; absent selects discovery' },
      flags: [
        { name: 'target', alias: null, value: '<name>', hidden: false, acceptedValues: null, shownValue: null, effect: 'select target', default: 'omitted', lineBreakAfter: false },
        { name: 'allow-empty', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'allow empty selection', default: 'false', lineBreakAfter: false },
        { name: 'list', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'list without inspection', default: 'false', lineBreakAfter: false },
        { name: 'json', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'JSON envelope', default: 'false', lineBreakAfter: false },
        { name: 'config', alias: null, value: '<path>', hidden: false, acceptedValues: null, shownValue: null, effect: 'explicit configuration', default: 'omitted', lineBreakAfter: false },
        { name: 'no-color', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'disable ANSI', default: 'false', lineBreakAfter: false },
      ],
    },
    {
      name: 'heal',
      summary: 'Repair deterministic plans',
      positional: { name: 'files', variadic: true, description: 'literal prompts; absent selects discovery' },
      flags: [
        { name: 'dry-run', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'measures repair without committing buffered Plan or Grounding changes', default: 'false', lineBreakAfter: false },
        { name: 'yes', alias: 'y', value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'authorizes non-interactive commit', default: 'false', lineBreakAfter: false },
        { name: 'target', alias: null, value: '<name>', hidden: false, acceptedValues: null, shownValue: null, effect: 'select target', default: 'omitted', lineBreakAfter: false },
        { name: 'ai', alias: null, value: '<claude|codex>', hidden: false, acceptedValues: ['claude', 'codex'], shownValue: null, effect: 'provider override', default: 'omitted', lineBreakAfter: false },
        { name: 'allow-empty', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'allow empty selection', default: 'false', lineBreakAfter: false },
        { name: 'list', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'list without healing', default: 'false', lineBreakAfter: false },
        { name: 'json', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'JSON envelope', default: 'false', lineBreakAfter: false },
        { name: 'no-color', alias: null, value: null, hidden: false, acceptedValues: null, shownValue: null, effect: 'disable ANSI', default: 'false', lineBreakAfter: false },
      ],
    },
  ],
  helpFooter: 'AI configuration:\n  ai.timeoutMs: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.\n  ai.maxGenerateAttempts: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.\n\nHeal configuration:\n  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.\n  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.\n',
};

/**
 * Composes the static declaration with the build-injected package version.
 *
 * Returns a `CliManifest` containing `version` and the unchanged static
 * declaration, rather than mutating the exported source data or reading
 * `package.json` from a source-path-dependent location.
 *
 * @param version - The version already injected into the calling build entry.
 * @returns The versioned public CLI manifest.
 */
export function createCliManifest(version: string): CliManifest {
  return { version, ...CLI_MANIFEST };
}

/**
 * Builds the command-local token lookup used by the manifest-driven parsers.
 *
 * The map keys every flag by `--${name}` and, when declared, by `-${alias}`;
 * both spellings point at the same descriptor. Keeping
 * lookup command-local ensures an alias such as `-y` is accepted only by the
 * command that declares it, while unregistered single-hyphen tokens retain
 * their positional treatment in the CLI layer.
 *
 * @param command - The command whose declared tokens populate the map.
 * @returns A read-only view of recognized spellings and their descriptors.
 */
export function flagLookup(command: CliCommand): ReadonlyMap<string, CliFlag> {
  const flags = new Map<string, CliFlag>();
  for (const flag of command.flags) {
    flags.set(`--${flag.name}`, flag);
    if (flag.alias !== null) {
      flags.set(`-${flag.alias}`, flag);
    }
  }
  return flags;
}

/**
 * Renders byte-stable `--help` text from a versionless manifest declaration.
 *
 * The renderer aligns command summaries from the longest positional syntax,
 * omits hidden flags, and splits option lines only at explicit
 * `lineBreakAfter` boundaries. It renders aliases beside their long spelling
 * and chooses `shownValue ?? value`. Explicit layout data avoids inferring
 * wrapping from flag counts or widths, which cannot reproduce all command
 * layouts.
 *
 * @param manifest - The versionless declaration that owns all visible text.
 * @returns The complete help text with its compatibility-preserving newline
 *   sequence.
 */
export function renderUsage(manifest: VersionlessCliManifest): string {
  const positionalSyntax = (command: CliCommand): string => command.positional === null
    ? command.name
    : `${command.name} [${command.positional.name}...]`;
  const column = Math.max(...manifest.commands.map(positionalSyntax).map((syntax) => syntax.length)) + 2;
  const commandsBlock = manifest.commands
    .map((command) => `  ${positionalSyntax(command).padEnd(column)}${command.summary}`)
    .join('\n');
  const optionsSection = (command: CliCommand): string => {
    const lines: string[] = [];
    let tokens: string[] = [];
    for (const flag of command.flags) {
      if (flag.hidden) {
        continue;
      }
      const shownValue = flag.shownValue ?? flag.value;
      const token = `${flag.alias === null ? `--${flag.name}` : `--${flag.name}, -${flag.alias}`}${shownValue === null ? '' : ` ${shownValue}`}`;
      tokens.push(token);
      if (flag.lineBreakAfter) {
        lines.push(`  ${tokens.join('  ')}`);
        tokens = [];
      }
    }
    if (tokens.length > 0) {
      lines.push(`  ${tokens.join('  ')}`);
    }
    return `${command.name[0]!.toUpperCase()}${command.name.slice(1)} options:\n${lines.join('\n')}\n`;
  };
  const parts = [
    'Usage: ambercast <command> [options]\n',
    `Commands:\n${commandsBlock}\n`,
    ...manifest.commands.map(optionsSection),
  ];

  return `${parts.join('\n')}\n${manifest.helpFooter}`;
}
