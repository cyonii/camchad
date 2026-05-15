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
  readonly notes?: string;
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
