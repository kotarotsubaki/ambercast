import type { ElementRef } from '../../../src/core/ir/schema.js';
import { computeAccessibilityFingerprint } from '../../../src/core/ir/fingerprint.js';
import { describe, expect, it } from 'vitest';
import type { BrowserSession } from '../../../src/ports/browser.js';
import type {
  AiExecuteRequest,
  AiExecuteResult,
  InstructionCoveredAiAgenticRequest,
} from '../../../src/ports/ai.js';
import { registerAiExecutorContract } from '../../contracts/ai-executor.contract.js';
import { registerUiExecutorContract } from '../../contracts/ui-executor.contract.js';
import { registerUiExecutorReplayContract } from '../../contracts/ui-executor-replay.contract.js';
import {
  fingerprintWithFlippedLeadingHexCharacter,
  registerBrowserSessionContract,
} from '../../contracts/browser-session.contract.js';
import { registerClockContract } from '../../contracts/clock.contract.js';
import { registerEnvironmentInfoContract } from '../../contracts/environment-info.contract.js';
import { registerEventSinkContract } from '../../contracts/event-sink.contract.js';
import { registerRandomSourceContract } from '../../contracts/random-source.contract.js';
import { registerSecretsProviderContract } from '../../contracts/secrets-provider.contract.js';
import { registerStorageContract } from '../../contracts/storage.contract.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createFixedRandom } from '../../doubles/create-fixed-random.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';
import { createFakeAiActionController } from '../../doubles/fake-ai-action-controller.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import {
  createFakeBrowserSession,
  elementRefKey,
  operationObservation,
  type FakeBrowserSession,
  type FakeBrowserSessionEntry,
} from '../../doubles/fake-browser-session.js';
import { createFakeEnvironmentInfo } from '../../doubles/fake-environment-info.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';

function sessionKey(ref: ElementRef): string {
  return elementRefKey(ref);
}

const fakeContractEntries = new WeakMap<FakeBrowserSession, Map<string, FakeBrowserSessionEntry>>();

function createContractSession(): BrowserSession {
  return createFakeBrowserSession(new Map());
}

registerBrowserSessionContract({
  createSession: (setup) => {
    const scriptedMissReasons = setup.scenario === 'ambiguous'
      ? { verify: 'ambiguous-match', compute: 'ambiguous-match' } as const
      : setup.scenario === 'snapshot-invalid'
        ? { verify: 'snapshot-invalid', compute: 'snapshot-invalid' } as const
        : undefined;
    const entries = new Map<string, FakeBrowserSessionEntry>([[
      sessionKey(setup.ref),
      {
        currentFingerprint: setup.currentFingerprint,
        exists: setup.exists,
        ...(scriptedMissReasons === undefined ? {} : { scriptedMissReasons }),
      },
    ]]);
    const session = createFakeBrowserSession(entries);
    fakeContractEntries.set(session, entries);
    return session;
  },
  navigationUrl: () => 'data:text/html,same-descriptor',
  supportedGroundingMissReasons: [
    'fingerprint-mismatch',
    'element-not-found',
    'ambiguous-match',
    'snapshot-invalid',
    'secret-contaminated',
  ],
  invalidateDescriptor: async (session, setup) => {
    const entries = fakeContractEntries.get(session as FakeBrowserSession);
    const entry = entries?.get(sessionKey(setup.ref));
    if (entry === undefined) {
      throw new Error('The fake contract fixture must retain the descriptor entry to invalidate it.');
    }

    entry.currentFingerprint = fingerprintWithFlippedLeadingHexCharacter(entry.currentFingerprint);
  },
  operationObservation: (session) => operationObservation(session as FakeBrowserSession),
});

registerUiExecutorContract({
  createExecutor: () => createFakeUiExecutor(createContractSession),
});

registerAiExecutorContract({
  createExecutor: (scripted) => createFakeAiExecutor({
    execute: <T>(request: AiExecuteRequest<T>) => {
      if (scripted.executeError !== undefined) {
        throw scripted.executeError;
      }

      return typeof scripted.execute === 'function'
        ? scripted.execute(request as AiExecuteRequest<unknown>) as AiExecuteResult<T>
        : scripted.execute as AiExecuteResult<T>;
    },
    executeAgentic: (request) => typeof scripted.executeAgentic === 'function'
      ? scripted.executeAgentic(request as InstructionCoveredAiAgenticRequest)
      : scripted.executeAgentic,
    available: true,
  }),
  createActionController: createFakeAiActionController,
});

registerStorageContract({
  createStorage: createInMemoryStorage,
});

registerClockContract({
  createClock: () => createFixedClock(new Date('2026-08-03T00:00:00.000Z'), 42),
});

registerRandomSourceContract({
  createRandom: () => createFixedRandom('123e4567-e89b-42d3-a456-426614174000', 0.5),
});

registerSecretsProviderContract({
  createSecrets: (known) => createFakeSecretsProvider(new Map([[known.ref, known.value]])),
});

registerEnvironmentInfoContract({
  createEnvironment: createFakeEnvironmentInfo,
});

registerEventSinkContract({
  createSink: createRecordingEventSink,
});

const replayElement = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;
const replayTarget = { surface: 'web', baseUrl: 'https://fake.example.test/' } as const;

function replayFixture(label: 'Alpha' | 'Beta') {
  const snapshot = {
    accessibilityTree: {
      role: 'document', name: '', children: [
        { role: 'button', name: 'Submit', children: [] },
        { role: 'text', name: label, children: [] },
      ],
    },
    screenshot: new Uint8Array(),
  };
  const computed = computeAccessibilityFingerprint(snapshot.accessibilityTree, replayElement, []);
  if (computed.kind !== 'ok') throw new Error(`Invalid replay fixture: ${computed.kind}`);
  const entry: FakeBrowserSessionEntry = { exists: true, currentFingerprint: computed.fingerprint };
  return { snapshot, entry };
}

const producer = replayFixture('Alpha');
const same = replayFixture('Alpha');
const divergent = replayFixture('Beta');

describe('TEST-9 replay fake fixture invariants', () => {
  for (const [name, fixture] of Object.entries({ producer, same, divergent })) {
    it(`${name} uses its snapshot fingerprint as current evidence`, () => {
      const computed = computeAccessibilityFingerprint(fixture.snapshot.accessibilityTree, replayElement, []);
      expect(computed.kind).toBe('ok');
      if (computed.kind === 'ok') expect(fixture.entry.currentFingerprint).toEqual(computed.fingerprint);
    });
  }
  it('changes the adjacent sibling fingerprint', () => {
    expect(producer.entry.currentFingerprint.hash).toBe(same.entry.currentFingerprint.hash);
    expect(producer.entry.currentFingerprint.hash).not.toBe(divergent.entry.currentFingerprint.hash);
  });
});

let lastDivergentSession: FakeBrowserSession | undefined;

function replayFactory(fixture: ReturnType<typeof replayFixture>, divergentRun = false) {
  return () => createFakeUiExecutor(() => {
    const session = createFakeBrowserSession(
      new Map([[elementRefKey(replayElement), { ...fixture.entry }]]),
      { snapshot: fixture.snapshot, baseUrl: replayTarget.baseUrl },
    );
    if (divergentRun) lastDivergentSession = session;
    return session;
  });
}

registerUiExecutorReplayContract({
  target: replayTarget,
  entryUrl: replayTarget.baseUrl,
  element: replayElement,
  readyText: 'Ready',
  producerFactory: replayFactory(producer),
  sameObservationFactory: replayFactory(same),
  divergentObservationFactory: replayFactory(divergent, true),
  inspectDivergentSession: () => lastDivergentSession?.operations() ?? [],
});
