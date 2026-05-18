import { describe, expect, it } from 'vitest';

import type { MovementInterpreterState } from '@camchad/movement-core';

import type { Clock, IdGenerator } from './session-service.js';
import { repEvent, ActivitySessionService } from './session-service.js';
import { InMemoryActivityRepository } from './activity-repository.js';

class FixedClock implements Clock {
  private index = 0;

  public constructor(private readonly dates: readonly Date[]) {}

  public now(): Date {
    const date = this.dates[this.index] ?? this.dates[this.dates.length - 1];
    this.index += 1;
    return date;
  }
}

class SequentialIds implements IdGenerator {
  private index = 0;

  public createId(prefix: string): string {
    this.index += 1;
    return `${prefix}_${this.index}`;
  }
}

describe('ActivitySessionService', () => {
  it('records a completed activity session with one movement segment', async () => {
    const repository = new InMemoryActivityRepository();
    const service = new ActivitySessionService(
      repository,
      new FixedClock([
        new Date('2026-05-12T07:00:00.000Z'),
        new Date('2026-05-12T07:00:10.000Z'),
        new Date('2026-05-12T07:00:25.000Z'),
        new Date('2026-05-12T07:02:00.000Z'),
        new Date('2026-05-12T07:02:05.000Z'),
      ]),
      new SequentialIds(),
    );

    service.startSession();
    service.startMovement('push_up', 'side');
    service.updateMovement(
      movementState({
        movementType: 'push_up',
        phase: 'top',
        reps: 1,
        validReps: 1,
        partialReps: 0,
        lastRep: repEvent(1),
        warnings: [],
        metrics: {
          temporalMovementConfidence: 0.84,
          sampleWindowMs: 320,
        },
      }),
      {
        activityState: 'moving',
        recognitionConfidence: 0.91,
      },
    );
    service.endMovement();
    const session = await service.endSession('Felt steady.');

    expect(session.id).toBe('session_1');
    expect(session.durationSeconds).toBe(125);
    expect(session.movements).toHaveLength(1);
    expect(session.timeline.map((event) => event.kind)).toEqual([
      'session_start',
      'movement_start',
      'rep_valid',
      'movement_end',
    ]);
    expect(session.timeline[2]).toMatchObject({
      kind: 'rep_valid',
      movementType: 'push_up',
      repNumber: 1,
      qualityScore: 90,
    });
    expect(session.timeline[3]).toMatchObject({
      movementType: 'push_up',
      activityState: 'moving',
      recognitionConfidence: 0.91,
    });
    expect(session.movements[0]?.repEvents).toHaveLength(1);
    expect(session.movements[0]).toMatchObject({
      activityState: 'moving',
      recognitionConfidence: 0.91,
      telemetryMetrics: {
        temporalMovementConfidence: 0.84,
        sampleWindowMs: 320,
      },
      setSummary: {
        averageConfidence: expect.closeTo(0.915, 3),
        minQualityScore: 90,
        maxQualityScore: 90,
        bestRepNumber: 1,
        worstRepNumber: 1,
        averageCadenceSeconds: 110,
        warningCounts: {},
      },
    });
    expect(session.summary).toMatchObject({
      movementMix: [{ movementType: 'push_up', reps: 1, validReps: 1, durationSeconds: 110 }],
      restPeriods: 0,
      confidenceTrend: 'unknown',
    });
    expect(await repository.summary()).toEqual({
      totalSessions: 1,
      totalReps: 1,
      validReps: 1,
      partialReps: 0,
      lastActivityAt: '2026-05-12T07:00:00.000Z',
    });
  });

  it('stores rest timing between completed movement sets', async () => {
    const service = new ActivitySessionService(
      new InMemoryActivityRepository(),
      new FixedClock([
        new Date('2026-05-12T07:00:00.000Z'),
        new Date('2026-05-12T07:00:10.000Z'),
        new Date('2026-05-12T07:00:30.000Z'),
        new Date('2026-05-12T07:00:50.000Z'),
        new Date('2026-05-12T07:01:10.000Z'),
        new Date('2026-05-12T07:01:15.000Z'),
      ]),
      new SequentialIds(),
    );

    service.startSession();
    service.startMovement('push_up', 'side');
    service.updateMovement(movementState({ movementType: 'push_up', reps: 1, validReps: 1 }));
    service.endMovement();
    service.startMovement('squat', 'side');
    service.endMovement();
    const session = await service.endSession();

    expect(session.movements[0]?.setSummary).toMatchObject({
      restAfterSeconds: 20,
    });
    expect(session.movements[1]?.setSummary).toMatchObject({
      restBeforeSeconds: 20,
    });
  });

  it('does not duplicate repeated lastRep updates from detector state', () => {
    const service = new ActivitySessionService(
      new InMemoryActivityRepository(),
      new FixedClock([new Date('2026-05-12T07:00:00.000Z')]),
      new SequentialIds(),
    );
    const firstRep = repEvent(1);

    service.startSession();
    service.startMovement('push_up', 'side');
    service.updateMovement(
      movementState({
        movementType: 'push_up',
        phase: 'top',
        reps: 1,
        validReps: 1,
        partialReps: 0,
        lastRep: firstRep,
        warnings: [],
        metrics: {},
      }),
    );
    const set = service.updateMovement(
      movementState({
        movementType: 'push_up',
        phase: 'top',
        reps: 1,
        validReps: 1,
        partialReps: 0,
        lastRep: firstRep,
        warnings: [],
        metrics: {},
      }),
    );

    expect(set.repEvents).toHaveLength(1);
  });

  it('merges guidance events by code while updating movement telemetry', () => {
    const service = new ActivitySessionService(
      new InMemoryActivityRepository(),
      new FixedClock([new Date('2026-05-12T07:00:00.000Z')]),
      new SequentialIds(),
    );

    service.startSession();
    service.startMovement('push_up', 'side');
    service.updateMovement(movementState({}), {
      guidanceEvents: [
        {
          code: 'low_confidence',
          severity: 'warning',
          title: 'Signal confidence low',
          message: 'Improve lighting.',
          confidence: 0.5,
        },
      ],
    });
    const set = service.updateMovement(movementState({}), {
      guidanceEvents: [
        {
          code: 'low_confidence',
          severity: 'warning',
          title: 'Signal confidence low',
          message: 'Improve lighting and contrast.',
          confidence: 0.7,
        },
      ],
    });

    expect(set.guidanceEvents).toHaveLength(1);
    expect(set.guidanceEvents?.[0]?.message).toBe('Improve lighting and contrast.');
  });

  it('records rest timeline events while a session is active', async () => {
    const service = new ActivitySessionService(
      new InMemoryActivityRepository(),
      new FixedClock([
        new Date('2026-05-12T07:00:00.000Z'),
        new Date('2026-05-12T07:00:30.000Z'),
        new Date('2026-05-12T07:01:00.000Z'),
      ]),
      new SequentialIds(),
    );

    service.startSession();
    service.recordRest({ activityState: 'resting', recognitionConfidence: 0.2 });
    const session = await service.endSession();

    expect(session.timeline.map((event) => event.kind)).toEqual(['session_start', 'rest']);
    expect(session.timeline[1]).toMatchObject({
      activityState: 'resting',
      recognitionConfidence: 0.2,
    });
  });

  it('records transition, ambiguity, tracking, guidance, and quality timeline events', async () => {
    const service = new ActivitySessionService(
      new InMemoryActivityRepository(),
      new FixedClock([
        new Date('2026-05-12T07:00:00.000Z'),
        new Date('2026-05-12T07:00:05.000Z'),
        new Date('2026-05-12T07:00:08.000Z'),
        new Date('2026-05-12T07:00:12.000Z'),
        new Date('2026-05-12T07:00:18.000Z'),
        new Date('2026-05-12T07:00:24.000Z'),
        new Date('2026-05-12T07:00:30.000Z'),
      ]),
      new SequentialIds(),
    );

    service.startSession();
    service.recordTransition({ activityState: 'moving', message: 'Movement pattern changed.' });
    service.recordMovementCandidate('squat', {
      recognitionConfidence: 0.54,
      competingMovementTypes: ['squat', 'lunge'],
    });
    service.recordMovementAmbiguous({
      recognitionConfidence: 0.62,
      competingMovementTypes: ['squat', 'lunge'],
      message: 'Squat and lunge candidates are close.',
    });
    service.recordTrackingLost({ activityState: 'tracking_lost', recognitionConfidence: 0.1 });
    service.recordTrackingRecovered({ activityState: 'setup', recognitionConfidence: 0.74 });
    service.recordCameraGuidance({
      code: 'body_near_edge',
      severity: 'warning',
      title: 'Body near frame edge',
      message: 'Re-center before continuing.',
      confidence: 0.8,
    });
    service.recordQualityWarning('squat', {
      code: 'partial_depth',
      message: 'Depth was incomplete.',
      recognitionConfidence: 0.7,
    });
    const session = await service.endSession();

    expect(session.timeline.map((event) => event.kind)).toEqual([
      'session_start',
      'transition',
      'movement_candidate',
      'movement_ambiguous',
      'tracking_lost',
      'tracking_recovered',
      'camera_guidance',
      'quality_warning',
    ]);
    expect(session.timeline[2]).toMatchObject({
      movementType: 'squat',
      competingMovementTypes: ['squat', 'lunge'],
    });
    expect(session.timeline[6]).toMatchObject({
      code: 'body_near_edge',
      message: 'Re-center before continuing.',
    });
  });
});

function movementState(overrides: Partial<MovementInterpreterState>): MovementInterpreterState {
  return {
    movementType: 'push_up',
    recognition: {
      movementType: 'push_up',
      confidence: 0.95,
      status: 'active',
      evidence: ['test'],
    },
    phase: 'setup_needed',
    reps: 0,
    validReps: 0,
    partialReps: 0,
    warnings: [],
    metrics: {},
    ...overrides,
  };
}
