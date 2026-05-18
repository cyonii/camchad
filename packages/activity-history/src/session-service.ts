import type {
  ActivityStateKind,
  CameraAngle,
  MovementGuidanceEvent,
  MovementInterpreterState,
  MovementType,
  RepEvent,
} from '@camchad/movement-core';

import type { ActivityTimelineEventKind, MovementSegment, ActivitySession } from './models.js';
import type { ActivityRepository } from './activity-repository.js';
import { summarizeActivitySession } from './session-summary.js';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  createId(prefix: string): string;
}

export interface MovementTelemetryUpdate {
  readonly activityState?: ActivityStateKind;
  readonly recognitionConfidence?: number;
  readonly guidanceEvents?: readonly MovementGuidanceEvent[];
  readonly competingMovementTypes?: readonly MovementType[];
  readonly message?: string;
  readonly code?: string;
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

    const startedAt = this.clock.now().toISOString();
    this.activeSession = {
      id: this.ids.createId('session'),
      startedAt,
      movements: [],
      timeline: [
        {
          id: this.ids.createId('event'),
          kind: 'session_start',
          timestamp: startedAt,
        },
      ],
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
    this.activeSession = {
      ...this.activeSession,
      timeline: [
        ...this.activeSession.timeline,
        {
          id: this.ids.createId('event'),
          kind: 'movement_start',
          timestamp: this.activeSegment.startedAt,
          movementType,
          movementSegmentId: this.activeSegment.id,
        },
      ],
    };

    return this.activeSegment;
  }

  public updateMovement(
    state: MovementInterpreterState,
    telemetry: MovementTelemetryUpdate = {},
  ): MovementSegment {
    if (!this.activeSegment) {
      throw new Error('Cannot update movement because no movement segment is active.');
    }

    const repEvents = [...this.activeSegment.repEvents];

    if (state.lastRep && !this.recordedRepNumbers.has(state.lastRep.repNumber)) {
      repEvents.push(state.lastRep);
      this.recordedRepNumbers.add(state.lastRep.repNumber);
      this.appendTimelineEvent(state.lastRep.warnings.length > 0 ? 'rep_partial' : 'rep_valid', {
        movementType: this.activeSegment.movementType,
        movementSegmentId: this.activeSegment.id,
        activityState: telemetry.activityState ?? this.activeSegment.activityState,
        recognitionConfidence:
          telemetry.recognitionConfidence ?? this.activeSegment.recognitionConfidence,
        repNumber: state.lastRep.repNumber,
        qualityScore: state.lastRep.qualityScore,
        rangeScore: state.lastRep.rangeScore,
        alignmentScore: state.lastRep.alignmentScore,
        rhythmScore: state.lastRep.rhythmScore,
        confidenceScore: state.lastRep.confidenceScore,
        trackingQualityScore: state.lastRep.trackingQualityScore,
        message:
          state.lastRep.warnings[0]?.message ??
          (state.lastRep.warnings.length > 0
            ? 'Partial repetition recorded.'
            : 'Valid repetition recorded.'),
        code: state.lastRep.warnings[0]?.code,
      });
    }

    this.activeSegment = {
      ...this.activeSegment,
      reps: state.reps,
      validReps: state.validReps,
      partialReps: state.partialReps,
      activityState: telemetry.activityState ?? this.activeSegment.activityState,
      recognitionConfidence:
        telemetry.recognitionConfidence ?? this.activeSegment.recognitionConfidence,
      telemetryMetrics: {
        ...this.activeSegment.telemetryMetrics,
        ...numericMetrics(state.metrics),
      },
      guidanceEvents: mergeGuidanceEvents(
        this.activeSegment.guidanceEvents ?? [],
        telemetry.guidanceEvents ?? [],
      ),
      formWarnings: mergeWarnings(this.activeSegment.formWarnings, state.warnings),
      repEvents,
    };

    return this.activeSegment;
  }

  public endMovement(): MovementSegment {
    if (!this.activeSession || !this.activeSegment) {
      throw new Error('Cannot end movement because no movement segment is active.');
    }

    const endedAt = this.clock.now().toISOString();
    const completedSet: MovementSegment = {
      ...this.activeSegment,
      endedAt,
    };

    this.activeSession = {
      ...this.activeSession,
      movements: [...this.activeSession.movements, completedSet],
      timeline: [
        ...this.activeSession.timeline,
        {
          id: this.ids.createId('event'),
          kind: 'movement_end',
          timestamp: endedAt,
          movementType: completedSet.movementType,
          movementSegmentId: completedSet.id,
          activityState: completedSet.activityState,
          recognitionConfidence: completedSet.recognitionConfidence,
        },
      ],
    };
    this.activeSegment = undefined;

    return completedSet;
  }

  public recordRest(telemetry: MovementTelemetryUpdate = {}): void {
    if (!this.activeSession) {
      throw new Error('Cannot record rest because no activity session is active.');
    }

    this.appendTimelineEvent('rest', telemetry);
  }

  public recordTransition(telemetry: MovementTelemetryUpdate = {}): void {
    this.appendTimelineEvent('transition', telemetry);
  }

  public recordTrackingLost(telemetry: MovementTelemetryUpdate = {}): void {
    this.appendTimelineEvent('tracking_lost', telemetry);
  }

  public recordTrackingRecovered(telemetry: MovementTelemetryUpdate = {}): void {
    this.appendTimelineEvent('tracking_recovered', telemetry);
  }

  public recordMovementCandidate(
    movementType: MovementType | undefined,
    telemetry: MovementTelemetryUpdate = {},
  ): void {
    this.appendTimelineEvent('movement_candidate', { ...telemetry, movementType });
  }

  public recordMovementAmbiguous(telemetry: MovementTelemetryUpdate = {}): void {
    this.appendTimelineEvent('movement_ambiguous', telemetry);
  }

  public recordCameraGuidance(event: MovementGuidanceEvent): void {
    this.appendTimelineEvent('camera_guidance', {
      code: event.code,
      message: event.message,
      recognitionConfidence: event.confidence,
    });
  }

  public recordQualityWarning(
    movementType: MovementType | undefined,
    telemetry: MovementTelemetryUpdate = {},
  ): void {
    this.appendTimelineEvent('quality_warning', { ...telemetry, movementType });
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
    const summarizedSession: ActivitySession = {
      ...completedSession,
      summary: summarizeActivitySession(completedSession),
    };

    await this.repository.saveSession(summarizedSession);
    this.activeSession = undefined;

    return summarizedSession;
  }

  public getActiveSession(): ActivitySession | undefined {
    return this.activeSession;
  }

  private appendTimelineEvent(
    kind: ActivityTimelineEventKind,
    telemetry: MovementTelemetryUpdate & {
      readonly movementType?: MovementType;
      readonly movementSegmentId?: string;
      readonly repNumber?: number;
      readonly qualityScore?: number;
      readonly rangeScore?: number;
      readonly alignmentScore?: number;
      readonly rhythmScore?: number;
      readonly confidenceScore?: number;
      readonly trackingQualityScore?: number;
    } = {},
  ): void {
    if (!this.activeSession) {
      throw new Error(`Cannot record ${kind} because no activity session is active.`);
    }

    this.activeSession = {
      ...this.activeSession,
      timeline: [
        ...this.activeSession.timeline,
        {
          id: this.ids.createId('event'),
          kind,
          timestamp: this.clock.now().toISOString(),
          movementType: telemetry.movementType,
          competingMovementTypes: telemetry.competingMovementTypes,
          movementSegmentId: telemetry.movementSegmentId,
          activityState: telemetry.activityState,
          recognitionConfidence: telemetry.recognitionConfidence,
          message: telemetry.message,
          code: telemetry.code,
          repNumber: telemetry.repNumber,
          qualityScore: telemetry.qualityScore,
          rangeScore: telemetry.rangeScore,
          alignmentScore: telemetry.alignmentScore,
          rhythmScore: telemetry.rhythmScore,
          confidenceScore: telemetry.confidenceScore,
          trackingQualityScore: telemetry.trackingQualityScore,
        },
      ],
    };
  }
}

function numericMetrics(
  metrics: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value)));
}

function mergeGuidanceEvents(
  existing: readonly MovementGuidanceEvent[],
  incoming: readonly MovementGuidanceEvent[],
): readonly MovementGuidanceEvent[] {
  const byCode = new Map(existing.map((event) => [event.code, event]));

  for (const event of incoming) {
    byCode.set(event.code, event);
  }

  return [...byCode.values()];
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
    rangeScore: 1,
    alignmentScore: 0.9,
    rhythmScore: 0.8,
    confidenceScore: 0.92,
    trackingQualityScore: 0.96,
    warnings: [],
    ...overrides,
  };
}
