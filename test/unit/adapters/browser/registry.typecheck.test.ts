import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { UI_EXECUTOR_KINDS, type UiExecutorKind } from '#core/executor/kinds.js';
import { UiExecutorKind as ConfigUiExecutorKind } from '#core/config/schema.js';
import type { UiExecutor } from '#ports/browser.js';
import type { UiExecutorFactory } from '#adapters/browser/registry.js';

describe('registry typecheck', () => {
  it('shares the kind vocabulary across core, config, port, and the published JSON schema', () => {
    expect(ConfigUiExecutorKind.options).toEqual(UI_EXECUTOR_KINDS);
    expectTypeOf<UiExecutor['kind']>().toEqualTypeOf<UiExecutorKind>();

    const schema = JSON.parse(readFileSync(new URL('../../../../dist/schema/config.schema.json', import.meta.url), 'utf8'));
    expect(schema.properties.targets.additionalProperties.properties.executor.properties.kind.enum).toEqual(['playwright']);
  });

  it('rejects unsupported port kinds and incomplete factory records at compile time', () => {
    // @ts-expect-error The port only accepts kinds from the shared vocabulary.
    const unsupportedKind: Pick<UiExecutor, 'kind'> = { kind: 'stagehand' };
    // @ts-expect-error Every supported kind requires a registered factory.
    const incompleteFactories = {} satisfies Record<UiExecutorKind, UiExecutorFactory>;
    void unsupportedKind;
    void incompleteFactories;
  });
});
