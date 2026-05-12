import type { PoseFrame } from '@home-workout/pose-core';

export type ExerciseType = 'push_up';

export type CameraAngle = 'side' | 'front_diagonal';

export type ExerciseDetectorPhase =
  | 'tracking_lost'
  | 'setup_needed'
  | 'top'
  | 'descending'
  | 'bottom'
  | 'ascending'
  | 'invalid_form';

export interface FormWarning {
  readonly code:
    | 'tracking_lost'
    | 'low_confidence'
    | 'body_alignment'
    | 'partial_depth'
    | 'camera_angle_experimental';
  readonly message: string;
}

export interface RepEvent {
  readonly repNumber: number;
  readonly timestampMs: number;
  readonly qualityScore: number;
  readonly depthScore: number;
  readonly alignmentScore: number;
  readonly warnings: readonly FormWarning[];
}

export interface ExerciseDetectorState {
  readonly exerciseType: ExerciseType;
  readonly phase: ExerciseDetectorPhase;
  readonly reps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly lastRep?: RepEvent;
  readonly warnings: readonly FormWarning[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface ExerciseDetector {
  readonly exerciseType: ExerciseType;
  processPose(frame: PoseFrame | undefined): ExerciseDetectorState;
  reset(): void;
  getState(): ExerciseDetectorState;
}
