/**
 * Exposes the core CLI manifest through runtime for the CLI layer.
 *
 * `tools/architecture-policy.mjs` deliberately limits the `cli` role to
 * runtime imports. This facade preserves that boundary while allowing the CLI
 * to use the core-owned, pure declaration without granting it a direct core
 * dependency; it adds no behavior or alternative source of truth.
 */
export {
  CLI_MANIFEST,
  createCliManifest,
  flagLookup,
  renderUsage,
  type CliManifest,
  type CliCommand,
  type CliFlag,
} from '#core/cli/manifest.js';
