import { describe, expect, it } from 'vitest';
import { getPageLocation, sidebar } from '../src/sidebar.mjs';

const expectedSidebar = [
  { label: 'START HERE', items: [{ slug: 'introduction' }, { slug: 'philosophy' }] },
  { label: 'TUTORIALS', items: [{ slug: 'tutorials/quick-start' }, { slug: 'tutorials/review-your-first-plan' }, { slug: 'tutorials/repair-your-first-drift' }, { slug: 'tutorials/github-actions' }] },
  { label: 'HOW-TO GUIDES', items: [{ slug: 'how-to/write-effective-prompts' }, { slug: 'how-to/manage-secrets' }, { slug: 'how-to/configure-targets' }, { slug: 'how-to/choose-ai-provider' }, { slug: 'how-to/select-tests' }, { slug: 'how-to/control-grounding-writeback' }, { slug: 'how-to/review-generated-diffs' }, { slug: 'how-to/manage-artifacts-in-git' }, { slug: 'how-to/run-on-other-ci' }, { slug: 'how-to/recover-stale-artifacts' }, { slug: 'how-to/upgrade' }, { slug: 'how-to/troubleshoot' }, { slug: 'how-to/contribute' }] },
  { label: 'REFERENCE', items: [{ label: 'CLI', items: [{ slug: 'reference/cli/overview' }, { slug: 'reference/cli/generate' }, { slug: 'reference/cli/run' }, { slug: 'reference/cli/check' }, { slug: 'reference/cli/heal' }, { slug: 'reference/cli/init' }, { slug: 'reference/cli/view' }, { slug: 'reference/cli/review' }, { slug: 'reference/cli/mcp' }, { slug: 'reference/cli/baseline-restore' }] }, { slug: 'reference/configuration' }, { slug: 'reference/prompt-format' }, { slug: 'reference/discovery-patterns' }, { slug: 'reference/reports' }, { slug: 'reference/error-codes' }, { slug: 'reference/exit-codes' }, { slug: 'reference/environment-variables' }, { slug: 'reference/file-layout' }, { slug: 'reference/json-schemas' }, { slug: 'reference/compatibility' }, { slug: 'reference/changelog' }, { slug: 'reference/security-policy' }, { slug: 'reference/glossary' }, { slug: 'reference/mcp-tools' }] },
  { label: 'PLAN SPECIFICATION', items: [{ slug: 'spec/overview' }, { slug: 'spec/plan-document' }, { slug: 'spec/steps' }, { slug: 'spec/value-types' }, { slug: 'spec/grounding-document' }, { slug: 'spec/fingerprint' }, { slug: 'spec/freshness' }, { slug: 'spec/canonical-json' }, { slug: 'spec/secrets' }, { slug: 'spec/conformance' }, { slug: 'spec/changelog' }] },
  { label: 'EXPLANATION', items: [{ slug: 'explanation/plan-lifecycle' }, { slug: 'explanation/replay-and-grounding' }, { slug: 'explanation/healing-model' }, { slug: 'explanation/trust-and-security' }, { slug: 'explanation/determinism-in-ci' }, { slug: 'explanation/comparison' }, { slug: 'explanation/status-and-roadmap' }] },
  { label: 'FOR AI AGENTS', items: [{ slug: 'agents/overview' }, { slug: 'agents/operating-contract' }, { slug: 'agents/setup-prompt' }, { slug: 'agents/reading-structured-output' }, { slug: 'agents/machine-readable-resources' }, { slug: 'agents/official-skill' }, { slug: 'agents/mcp-server' }] },
];

describe('documentation sidebar', () => {
  it('matches the specification’s complete literal group and page order', () => {
    expect(sidebar).toEqual(expectedSidebar);
  });

  it('nests CLI under REFERENCE and gives subgroup pages the displayed composite label', () => {
    expect(sidebar[3]).toEqual(expectedSidebar[3]);
    expect(getPageLocation('reference/cli/run')).toEqual({ groupLabel: 'REFERENCE · CLI', indexInGroup: 3 });
  });

  it('numbers pages one-based and resets for every displayed group and subgroup', () => {
    expect(getPageLocation('introduction')).toEqual({ groupLabel: 'START HERE', indexInGroup: 1 });
    expect(getPageLocation('philosophy')).toEqual({ groupLabel: 'START HERE', indexInGroup: 2 });
    expect(getPageLocation('reference/configuration')).toEqual({ groupLabel: 'REFERENCE', indexInGroup: 1 });
    expect(getPageLocation('reference/cli/overview')).toEqual({ groupLabel: 'REFERENCE · CLI', indexInGroup: 1 });
    expect(getPageLocation('spec/changelog')).toEqual({ groupLabel: 'PLAN SPECIFICATION', indexInGroup: 11 });
  });

  it('leaves the landing page and unknown slugs to the caller fallback', () => {
    expect(getPageLocation('agents/mcp-server')).toEqual({ groupLabel: 'FOR AI AGENTS', indexInGroup: 7 });
    expect(getPageLocation('')).toBeUndefined();
    expect(getPageLocation('not-a-page')).toBeUndefined();
    expect(getPageLocation('ja/reference/cli/run')).toBeUndefined();
  });
});
