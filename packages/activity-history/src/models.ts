import type {
  CameraAngle,
  MovementType,
  FormWarning,
  RepEvent,
} from '@home-activity/movement-core';

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
