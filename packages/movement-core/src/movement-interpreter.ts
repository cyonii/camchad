import type { PoseFrame } from '@camchad/pose-core';

export type MovementType =
  | 'push_up'
  | 'squat'
  | 'sit_up'
  | 'lunge'
  | 'jumping_jack'
  | 'plank'
  | 'pull_up'
  | 'burpee'
  | 'mountain_climber'
  | 'high_knees'
  | 'lateral_raise'
  | 'yoga_hold'
  | 'crunch'
  | 'leg_raise'
  | 'glute_bridge'
  | 'wall_sit'
  | 'calf_raise'
  | 'step_up'
  | 'tricep_dip'
  | 'bicep_curl'
  | 'shoulder_press'
  | 'deadlift'
  | 'bear_crawl'
  | 'side_plank'
  | 'bird_dog'
  | 'superman_hold'
  | 'russian_twist';

export type CameraAngle = 'side' | 'front' | 'front_diagonal';

export type MovementPhase =
  | 'tracking_lost'
  | 'setup_needed'
  | 'top'
  | 'descending'
  | 'bottom'
  | 'ascending'
  | 'invalid_form';

export type MovementStateKind =
  | 'setup'
  | 'active_rep'
  | 'partial_rep'
  | 'failed_rep'
  | 'rest'
  | 'tracking_lost';

export interface FormWarning {
  readonly code:
    | 'tracking_lost'
    | 'low_confidence'
    | 'body_alignment'
    | 'hand_position'
    | 'posture_alignment'
    | 'lower_body_visibility'
    | 'partial_depth'
    | 'range_of_motion'
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
  readonly stateKind?: MovementStateKind;
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
