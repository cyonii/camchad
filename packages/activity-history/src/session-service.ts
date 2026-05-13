import type {
  CameraAngle,
  MovementInterpreterState,
  MovementType,
  RepEvent,
} from '@camchad/movement-core';

import type { MovementSegment, ActivitySession } from './models.js';
import type { ActivityRepository } from './activity-repository.js';

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

export class ActivitySessionService {
  private activeSession?: ActivitySession;
  private activeSegment?: MovementSegment;
  private recordedRepNumbers = new Set<number>();

  public constructor(
    private readonly repository: ActivityRepository,
    private readonly clock: Clock = new SystemClock(),
    private readonly ids: IdGenerator = new CryptoIdGenerator(),
  ) {}

  public startSession(): ActivitySession {
    if (this.activeSession) {
      throw new Error('An activity session is already active.');
    }

    this.activeSession = {
      id: this.ids.createId('session'),
      startedAt: this.clock.now().toISOString(),
      movements: [],
    };

    return this.activeSession;
  }

  public startMovement(movementType: MovementType, cameraAngle: CameraAngle): MovementSegment {
    if (!this.activeSession) {
      throw new Error('Cannot start a movement without an active activity session.');
    }

    if (this.activeSegment) {
      throw new Error('A movement segment is already active.');
    }

    this.recordedRepNumbers = new Set();
    this.activeSegment = {
      id: this.ids.createId('set'),
      movementType,
      cameraAngle,
      startedAt: this.clock.now().toISOString(),
      reps: 0,
      validReps: 0,
      partialReps: 0,
      formWarnings: [],
      repEvents: [],
    };

    return this.activeSegment;
  }

  public updateMovement(state: MovementInterpreterState): MovementSegment {
    if (!this.activeSegment) {
      throw new Error('Cannot update movement because no movement segment is active.');
    }

    const repEvents = [...this.activeSegment.repEvents];

    if (state.lastRep && !this.recordedRepNumbers.has(state.lastRep.repNumber)) {
      repEvents.push(state.lastRep);
      this.recordedRepNumbers.add(state.lastRep.repNumber);
    }

    this.activeSegment = {
      ...this.activeSegment,
      reps: state.reps,
      validReps: state.validReps,
      partialReps: state.partialReps,
      formWarnings: mergeWarnings(this.activeSegment.formWarnings, state.warnings),
      repEvents,
    };

    return this.activeSegment;
  }

  public endMovement(): MovementSegment {
    if (!this.activeSession || !this.activeSegment) {
      throw new Error('Cannot end movement because no movement segment is active.');
    }

    const completedSet: MovementSegment = {
      ...this.activeSegment,
      endedAt: this.clock.now().toISOString(),
    };

    this.activeSession = {
      ...this.activeSession,
      movements: [...this.activeSession.movements, completedSet],
    };
    this.activeSegment = undefined;

    return completedSet;
  }

  public async endSession(notes?: string): Promise<ActivitySession> {
    if (!this.activeSession) {
      throw new Error('Cannot end activity because no session is active.');
    }

    if (this.activeSegment) {
      this.endMovement();
    }

    const endedAt = this.clock.now();
    const startedAt = new Date(this.activeSession.startedAt);
    const completedSession: ActivitySession = {
      ...this.activeSession,
      endedAt: endedAt.toISOString(),
      durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)),
      notes,
    };

    await this.repository.saveSession(completedSession);
    this.activeSession = undefined;

    return completedSession;
  }

  public getActiveSession(): ActivitySession | undefined {
    return this.activeSession;
  }
}

function mergeWarnings(
  existing: readonly MovementSegment['formWarnings'][number][],
  incoming: readonly MovementSegment['formWarnings'][number][],
): readonly MovementSegment['formWarnings'][number][] {
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
