import type { PoseFrame } from '@home-workout/pose-core';

export type MovementType = 'push_up';

export type CameraAngle = 'side' | 'front_diagonal';

export type MovementPhase =
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

export type MovementRecognitionStatus = 'tracking_lost' | 'candidate' | 'active';

export interface MovementRecognition {
  readonly movementType?: MovementType;
  readonly confidence: number;
  readonly status: MovementRecognitionStatus;
  readonly evidence: readonly string[];
}

export interface MovementInterpreterState {
  readonly movementType: MovementType;
  readonly recognition: MovementRecognition;
  readonly phase: MovementPhase;
  readonly reps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly lastRep?: RepEvent;
  readonly warnings: readonly FormWarning[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface MovementInterpreter {
  readonly movementType: MovementType;
  processPose(frame: PoseFrame | undefined): MovementInterpreterState;
  reset(): void;
  getState(): MovementInterpreterState;
}
