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
    expect(session.movements[0]?.repEvents).toHaveLength(1);
    expect(session.movements[0]).toMatchObject({
      activityState: 'moving',
      recognitionConfidence: 0.91,
      telemetryMetrics: {
        temporalMovementConfidence: 0.84,
        sampleWindowMs: 320,
      },
    });
    expect(await repository.summary()).toEqual({
      totalSessions: 1,
      totalReps: 1,
      validReps: 1,
      partialReps: 0,
      lastActivityAt: '2026-05-12T07:00:00.000Z',
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
