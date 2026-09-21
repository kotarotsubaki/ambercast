import { describe, expect, expectTypeOf, it } from 'vitest';
import type { StepId } from '../../../src/core/ir/schema.js';
import { HealStageTwoRejectionReason, type HealStageTwoRejectionReason as ReportStageTwoRejectionReason } from '../../../src/report/schema.js';
import type {
  Clock,
  EnvironmentInfo,
  EventSink,
  RandomSource,
  RunEvent,
  SecretsProvider,
  StageTwoRejectionReason,
} from '../../../src/ports/system.js';

describe('system port shapes', () => {
  it('defines time, randomness, secret, and environment operations', () => {
    expectTypeOf<Clock['now']>().toEqualTypeOf<() => Date>();
    expectTypeOf<Clock['monotonicMs']>().toEqualTypeOf<() => number>();
    expectTypeOf<RandomSource['uuid']>().toEqualTypeOf<() => string>();
    expectTypeOf<RandomSource['float']>().toEqualTypeOf<() => number>();
    expectTypeOf<SecretsProvider['resolve']>().toEqualTypeOf<(ref: string) => string | undefined>();
    expectTypeOf<EnvironmentInfo['isCI']>().toEqualTypeOf<() => boolean>();
  });

  it('defines run-event variants and the synchronous event sink', () => {
    expectTypeOf<RunEvent>().toEqualTypeOf<
      | { readonly type: 'step-start'; readonly stepId: StepId }
      | { readonly type: 'step-result'; readonly stepId: StepId; readonly via: 'grounding' | 'ai-resolve' | 'trace-replay' }
      | {
        readonly type: 'ai-call';
        readonly callId: string;
        readonly file: string;
        readonly attempt: number;
        readonly attemptLimit: number;
        readonly stepId?: StepId;
      }
      | {
        readonly type: 'ai-result';
        readonly callId: string;
        readonly durationMs: number;
        readonly outcome: 'ok' | 'error';
      }
      | {
        readonly type: 'unclassified-rejection';
        readonly file: string;
        readonly stepId?: StepId;
        readonly name: string;
        readonly message: string;
        readonly stack?: string;
      }
      | {
        readonly type: 'heal-stage2-rejected';
        readonly stepId: StepId;
        readonly reason: 'provider-error' | 'response-shape' | 'id-mismatch' | 'secret-name-invalid' | 'coverage-invalid' | 'obligation-mismatch' | 'literal-secret' | 'no-advance';
      }
    >();
    expectTypeOf<EventSink['emit']>().toEqualTypeOf<(event: RunEvent) => void>();
  });
});

describe('Stage 2 rejection reason report mirror', () => {
  it('keeps the system-port and report-schema types mutually assignable and their runtime values identical', () => {
    expectTypeOf<StageTwoRejectionReason>().toEqualTypeOf<ReportStageTwoRejectionReason>();
    expectTypeOf<ReportStageTwoRejectionReason>().toEqualTypeOf<StageTwoRejectionReason>();
    expect([...HealStageTwoRejectionReason.options].sort()).toEqual([
      'coverage-invalid',
      'id-mismatch',
      'literal-secret',
      'no-advance',
      'obligation-mismatch',
      'provider-error',
      'response-shape',
      'secret-name-invalid',
    ]);
  });
});
