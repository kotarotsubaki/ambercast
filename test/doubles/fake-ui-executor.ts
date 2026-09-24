import type { UiExecutor, BrowserSession } from '../../src/ports/browser.js';
import type { TargetDefinition } from '../../src/core/ir/schema.js';
import { UI_CAPABILITIES, type UiCapability } from '#core/ir/capabilities.js';

export interface RecordingFakeUiExecutor extends UiExecutor {
  readonly launches: TargetDefinition[];
}

/**
 * Builds the thin driver double used when a test needs launch composition but
 * not browser-engine behavior. The factory stays lazy so each launch can own
 * an independently arranged session.
 *
 * @param sessionFactory - Creates the session returned from each launch.
 * @returns A Chromium driver, the only engine the IR defines.
 */
export function createFakeUiExecutor(
  sessionFactory: Readonly<Record<string, () => BrowserSession>>,
  definitions?: Readonly<Record<string, TargetDefinition>>,
  capabilities?: ReadonlySet<UiCapability>,
): RecordingFakeUiExecutor;
export function createFakeUiExecutor(sessionFactory: () => BrowserSession, definitions?: Readonly<Record<string, TargetDefinition>>, capabilities?: ReadonlySet<UiCapability>): RecordingFakeUiExecutor;
export function createFakeUiExecutor(
  sessionFactory: (() => BrowserSession) | Readonly<Record<string, () => BrowserSession>>,
  definitions: Readonly<Record<string, TargetDefinition>> = {},
  capabilities: ReadonlySet<UiCapability> = new Set(UI_CAPABILITIES),
): RecordingFakeUiExecutor {
  const launches: TargetDefinition[] = [];
  const namedDefinitions = Object.entries(definitions);
  return {
    kind: 'playwright',
    surface: 'web',
    capabilities,
    launches,
    async launch(definition: TargetDefinition): Promise<BrowserSession> {
      launches.push(definition);
      if (typeof sessionFactory === 'function') return sessionFactory();
      const byReference = namedDefinitions.find(([, candidate]) => candidate === definition)?.[0];
      const byContent = namedDefinitions.filter(([, candidate]) =>
        JSON.stringify(candidate) === JSON.stringify(definition));
      const name = byReference ?? (byContent.length === 1 ? byContent[0]?.[0] : undefined)
        ?? (definition as TargetDefinition & { name?: string }).name;
      const factory = name === undefined ? undefined : sessionFactory[name];
      if (factory === undefined) throw new Error(`No fake session for ${name ?? definition.baseUrl}.`);
      return factory();
    },
  };
}
