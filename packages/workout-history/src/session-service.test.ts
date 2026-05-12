import { describe, expect, it } from 'vitest';

import type { MovementInterpreterState } from '@home-workout/movement-core';

import type { Clock, IdGenerator } from './session-service.js';
import { repEvent, WorkoutSessionService } from './session-service.js';
import { InMemoryWorkoutRepository } from './workout-repository.js';

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

describe('WorkoutSessionService', () => {
  it('records a completed workout session with one exercise set', async () => {
    const repository = new InMemoryWorkoutRepository();
    const service = new WorkoutSessionService(
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
    service.startExercise('push_up', 'side');
    service.updateExercise(
      movementState({
        movementType: 'push_up',
        phase: 'top',
        reps: 1,
        validReps: 1,
        partialReps: 0,
        lastRep: repEvent(1),
        warnings: [],
        metrics: {},
      }),
    );
    service.endExercise();
    const session = await service.endSession('Felt steady.');

    expect(session.id).toBe('session_1');
    expect(session.durationSeconds).toBe(125);
    expect(session.exercises).toHaveLength(1);
    expect(session.exercises[0]?.repEvents).toHaveLength(1);
    expect(await repository.summary()).toEqual({
      totalSessions: 1,
      totalReps: 1,
      validReps: 1,
      partialReps: 0,
      lastWorkoutAt: '2026-05-12T07:00:00.000Z',
    });
  });

  it('does not duplicate repeated lastRep updates from detector state', () => {
    const service = new WorkoutSessionService(
      new InMemoryWorkoutRepository(),
      new FixedClock([new Date('2026-05-12T07:00:00.000Z')]),
      new SequentialIds(),
    );
    const firstRep = repEvent(1);

    service.startSession();
    service.startExercise('push_up', 'side');
    service.updateExercise(
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
    const set = service.updateExercise(
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
