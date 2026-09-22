import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AGENTS_BLOCK,
  CONFIG_TEMPLATE,
  GITIGNORE_APPEND_UNIT,
  SAMPLE_TEMPLATE,
} from '../../../../src/core/init/templates.js';

const expectedConfig = `{
  "$schema": "./node_modules/ambercast/dist/schema/config.schema.json",
  "testDir": "tests/ambercast",
  "targets": {
    "web-user": {
      "baseUrl": "http://localhost:3000"
    }
  },
  "defaultTarget": "web-user"
}
`;
const expectedSample = '# Find a page\n\nWhen I open the application, navigate to the search page, search for "ambercast", and see "Search results".\n';
const expectedGitignoreUnit = '# ambercast run evidence\ntests/ambercast/.runs/\n';
const expectedAgentsBlock = `<!-- ambercast:begin -->
## ambercast (AI-driven end-to-end tests)

- Config: \`ambercast.config.json\` (the config file is the source of truth; values below are the initial ones written by \`ambercast init\`).
- Prompts: \`tests/ambercast/*.test.md\`, plain-language test cases (see \`tests/ambercast/find-page.test.md\`).
- Loop: \`npx ambercast generate <file>\` → \`npx ambercast run --resolve <file>\` → \`npx ambercast check <file>\` → \`npx ambercast heal <file>\`; read \`npx ambercast --help\` first.
- Docs and the official agent skill: https://kotarotsubaki.github.io/ambercast/agents/setup-prompt/
<!-- ambercast:end -->
`;

describe('init scaffold templates', () => {
  it('keeps the config literal byte-for-byte, including its ordered keys and final LF', () => {
    expect(CONFIG_TEMPLATE).toBe(expectedConfig);
  });

  it('keeps the sample prompt literal byte-for-byte', () => {
    expect(SAMPLE_TEMPLATE).toBe(expectedSample);
  });

  it('keeps the sample prompt byte-identical to quick-start step 1', () => {
    const quickStart = readFileSync(
      new URL('../../../../website/src/content/docs/tutorials/quick-start.md', import.meta.url),
      'utf8',
    );
    const fence = /^```markdown\n([\s\S]*?)\n```$/m.exec(quickStart);

    expect(fence).not.toBeNull();
    expect(`${fence?.[1]}\n`).toBe(SAMPLE_TEMPLATE);
  });

  it('keeps the gitignore append unit byte-for-byte', () => {
    expect(GITIGNORE_APPEND_UNIT).toBe(expectedGitignoreUnit);
  });

  it('keeps the complete marker-managed AGENTS.md block byte-for-byte', () => {
    expect(AGENTS_BLOCK).toBe(expectedAgentsBlock);
  });
});
