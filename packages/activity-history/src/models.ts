import type {
  ActivityStateKind,
  CameraAngle,
  MovementGuidanceEvent,
  MovementType,
  FormWarning,
  RepEvent,
} from '@camchad/movement-core';

export interface ActivitySession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly movements: readonly MovementSegment[];
  readonly timeline: readonly ActivityTimelineEvent[];
  readonly summary?: ActivitySessionAnalysisSummary;
  readonly notes?: string;
}

export type ActivityTimelineEventKind =
  | 'session_start'
  | 'movement_start'
  | 'movement_end'
  | 'rest';

export interface ActivityTimelineEvent {
  readonly id: string;
  readonly kind: ActivityTimelineEventKind;
  readonly timestamp: string;
  readonly movementType?: MovementType;
  readonly movementSegmentId?: string;
  readonly activityState?: ActivityStateKind;
  readonly recognitionConfidence?: number;
}

export interface ActivitySessionAnalysisSummary {
  readonly movementMix: readonly ActivitySessionMovementMix[];
  readonly restPeriods: number;
  readonly confidenceTrend: 'improving' | 'declining' | 'stable' | 'unknown';
  readonly fatigueScore: number;
  readonly commonFailureModes: readonly string[];
}

export interface ActivitySessionMovementMix {
  readonly movementType: MovementType;
  readonly reps: number;
  readonly validReps: number;
  readonly durationSeconds: number;
}

export interface MovementSegment {
  readonly id: string;
  readonly movementType: MovementType;
  readonly cameraAngle: CameraAngle;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly reps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly activityState?: ActivityStateKind;
  readonly recognitionConfidence?: number;
  readonly telemetryMetrics?: Readonly<Record<string, number>>;
  readonly guidanceEvents?: readonly MovementGuidanceEvent[];
  readonly formWarnings: readonly FormWarning[];
  readonly repEvents: readonly RepEvent[];
  readonly videoRecording?: VideoRecording;
}

export interface VideoRecording {
  readonly localPath: string;
  readonly durationSeconds: number;
  readonly sizeBytes: number;
}

export interface ActivitySummary {
  readonly totalSessions: number;
  readonly totalReps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly lastActivityAt?: string;
}
