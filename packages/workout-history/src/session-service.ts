import type {
  CameraAngle,
  ExerciseDetectorState,
  ExerciseType,
  RepEvent,
} from '@home-workout/exercise-core';

import type { ExerciseSet, WorkoutSession } from './models.js';
import type { WorkoutRepository } from './workout-repository.js';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  createId(prefix: string): string;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  public createId(prefix: string): string {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
}

export class WorkoutSessionService {
  private activeSession?: WorkoutSession;
  private activeSet?: ExerciseSet;
  private recordedRepNumbers = new Set<number>();

  public constructor(
    private readonly repository: WorkoutRepository,
    private readonly clock: Clock = new SystemClock(),
    private readonly ids: IdGenerator = new CryptoIdGenerator(),
  ) {}

  public startSession(): WorkoutSession {
    if (this.activeSession) {
      throw new Error('A workout session is already active.');
    }

    this.activeSession = {
      id: this.ids.createId('session'),
      startedAt: this.clock.now().toISOString(),
      exercises: [],
    };

    return this.activeSession;
  }

  public startExercise(exerciseType: ExerciseType, cameraAngle: CameraAngle): ExerciseSet {
    if (!this.activeSession) {
      throw new Error('Cannot start an exercise without an active workout session.');
    }

    if (this.activeSet) {
      throw new Error('An exercise set is already active.');
    }

    this.recordedRepNumbers = new Set();
    this.activeSet = {
      id: this.ids.createId('set'),
      exerciseType,
      cameraAngle,
      startedAt: this.clock.now().toISOString(),
      reps: 0,
      validReps: 0,
      partialReps: 0,
      formWarnings: [],
      repEvents: [],
    };

    return this.activeSet;
  }

  public updateExercise(state: ExerciseDetectorState): ExerciseSet {
    if (!this.activeSet) {
      throw new Error('Cannot update exercise because no exercise set is active.');
    }

    const repEvents = [...this.activeSet.repEvents];

    if (state.lastRep && !this.recordedRepNumbers.has(state.lastRep.repNumber)) {
      repEvents.push(state.lastRep);
      this.recordedRepNumbers.add(state.lastRep.repNumber);
    }

    this.activeSet = {
      ...this.activeSet,
      reps: state.reps,
      validReps: state.validReps,
      partialReps: state.partialReps,
      formWarnings: mergeWarnings(this.activeSet.formWarnings, state.warnings),
      repEvents,
    };

    return this.activeSet;
  }

  public endExercise(): ExerciseSet {
    if (!this.activeSession || !this.activeSet) {
      throw new Error('Cannot end exercise because no exercise set is active.');
    }

    const completedSet: ExerciseSet = {
      ...this.activeSet,
      endedAt: this.clock.now().toISOString(),
    };

    this.activeSession = {
      ...this.activeSession,
      exercises: [...this.activeSession.exercises, completedSet],
    };
    this.activeSet = undefined;

    return completedSet;
  }

  public async endSession(notes?: string): Promise<WorkoutSession> {
    if (!this.activeSession) {
      throw new Error('Cannot end workout because no session is active.');
    }

    if (this.activeSet) {
      this.endExercise();
    }

    const endedAt = this.clock.now();
    const startedAt = new Date(this.activeSession.startedAt);
    const completedSession: WorkoutSession = {
      ...this.activeSession,
      endedAt: endedAt.toISOString(),
      durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
      notes,
    };

    await this.repository.saveSession(completedSession);
    this.activeSession = undefined;

    return completedSession;
  }

  public getActiveSession(): WorkoutSession | undefined {
    return this.activeSession;
  }
}

function mergeWarnings(
  existing: readonly ExerciseSet['formWarnings'][number][],
  incoming: readonly ExerciseSet['formWarnings'][number][],
): readonly ExerciseSet['formWarnings'][number][] {
  const byCode = new Map(existing.map((warning) => [warning.code, warning]));

  for (const warning of incoming) {
    byCode.set(warning.code, warning);
  }

  return [...byCode.values()];
}

export function repEvent(repNumber: number, overrides: Partial<RepEvent> = {}): RepEvent {
  return {
    repNumber,
    timestampMs: 1000 * repNumber,
    qualityScore: 90,
    depthScore: 1,
    alignmentScore: 0.9,
    warnings: [],
    ...overrides,
  };
}
