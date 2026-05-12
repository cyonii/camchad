import type { CameraAngle, ExerciseType, FormWarning, RepEvent } from '@home-workout/exercise-core';

export interface WorkoutSession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly exercises: readonly ExerciseSet[];
  readonly notes?: string;
}

export interface ExerciseSet {
  readonly id: string;
  readonly exerciseType: ExerciseType;
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

export interface WorkoutSummary {
  readonly totalSessions: number;
  readonly totalReps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly lastWorkoutAt?: string;
}
