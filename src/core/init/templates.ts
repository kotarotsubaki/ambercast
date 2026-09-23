/**
 * Canonical configuration scaffold. It has no BOM, uses LF line endings, and
 * ends in LF. Creating or forcibly replacing the configuration writes these
 * bytes verbatim, intentionally normalizing any existing BOM or other EOLs.
 */
export const CONFIG_TEMPLATE = `{
  "$schema": "./node_modules/ambercast/dist/schema/config.schema.json",
  "testDir": "tests/ambercast",
  "targets": {
    "web-user": {
      "baseUrl": "http://localhost:3000",
      "browser": "chromium"
    }
  },
  "defaultTarget": "web-user"
}
`;

/**
 * Canonical sample prompt. Its BOM-free, LF-terminated bytes stay identical
 * to the quick-start sample so the generated first test matches the guide.
 */
export const SAMPLE_TEMPLATE = '# Find a page\n\nWhen I open the application, navigate to the search page, search for "ambercast", and see "Search results".\n';

/**
 * Canonical run-evidence ignore unit. It is BOM-free and LF-terminated here;
 * append operations project its line endings to the existing file's EOL.
 */
export const GITIGNORE_APPEND_UNIT = '# ambercast run evidence\ntests/ambercast/.runs/\n';

/**
 * Canonical marker-managed `AGENTS.md` block. It is BOM-free and LF-terminated
 * here; append and replacement project its EOL while preserving an existing
 * file's BOM outside the managed block.
 */
export const AGENTS_BLOCK = `<!-- ambercast:begin -->
## ambercast (AI-driven end-to-end tests)

- Config: \`ambercast.config.json\` (the config file is the source of truth; values below are the initial ones written by \`ambercast init\`).
- Prompts: \`tests/ambercast/*.test.md\`, plain-language test cases (see \`tests/ambercast/find-page.test.md\`).
- Loop: \`npx ambercast generate <file>\` → \`npx ambercast run --resolve <file>\` → \`npx ambercast check <file>\` → \`npx ambercast heal <file>\`; read \`npx ambercast --help\` first.
- Docs and the official agent skill: https://kotarotsubaki.github.io/ambercast/agents/setup-prompt/
<!-- ambercast:end -->
`;
