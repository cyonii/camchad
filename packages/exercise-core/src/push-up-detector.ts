import {
  angleDegrees,
  lineDeviationRatio,
  midpoint,
  requiredLandmarksVisible,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@home-workout/pose-core';

import type {
  CameraAngle,
  ExerciseDetector,
  ExerciseDetectorPhase,
  ExerciseDetectorState,
  FormWarning,
  RepEvent,
} from './exercise-detector.js';

const requiredPushUpLandmarks: readonly LandmarkName[] = [
  'left_shoulder',
  'left_elbow',
  'left_wrist',
  'left_hip',
  'left_knee',
  'left_ankle',
  'right_shoulder',
  'right_elbow',
  'right_wrist',
  'right_hip',
  'right_knee',
  'right_ankle',
];

export interface PushUpDetectorConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topElbowAngle: number;
  readonly bottomElbowAngle: number;
  readonly maxBodyLineDeviation: number;
  readonly minBottomHoldMs: number;
}

export const defaultPushUpConfig: PushUpDetectorConfig = {
  cameraAngle: 'side',
  minVisibility: 0.55,
  topElbowAngle: 153,
  bottomElbowAngle: 105,
  maxBodyLineDeviation: 0.1,
  minBottomHoldMs: 120,
};

export class PushUpDetector implements ExerciseDetector {
  public readonly exerciseType = 'push_up';

  private phase: ExerciseDetectorPhase = 'setup_needed';
  private reps = 0;
  private validReps = 0;
  private partialReps = 0;
  private lastRep?: RepEvent;
  private bottomEnteredAt?: number;
  private lowestElbowAngle = 180;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};

  public constructor(private readonly config: PushUpDetectorConfig = defaultPushUpConfig) {}

  public processPose(frame: PoseFrame | undefined): ExerciseDetectorState {
    if (!frame) {
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      return this.getState();
    }

    if (!requiredLandmarksVisible(frame, requiredPushUpLandmarks, this.config.minVisibility)) {
      this.phase = 'tracking_lost';
      this.warnings = [lowConfidenceWarning];
      return this.getState();
    }

    const sample = readPushUpSample(frame);
    const elbowAngle = Math.min(sample.leftElbowAngle, sample.rightElbowAngle);
    const bodyLineDeviation = Math.min(sample.leftBodyLineDeviation, sample.rightBodyLineDeviation);
    const alignmentScore = clamp01(1 - bodyLineDeviation / this.config.maxBodyLineDeviation);
    const isAligned = bodyLineDeviation <= this.config.maxBodyLineDeviation;
    const reachedBottom = elbowAngle <= this.config.bottomElbowAngle;
    const reachedTop = elbowAngle >= this.config.topElbowAngle;

    this.lowestElbowAngle = Math.min(this.lowestElbowAngle, elbowAngle);
    this.metrics = {
      elbowAngle,
      bodyLineDeviation,
      alignmentScore,
      shoulderY: sample.shoulderCenter.y,
      hipY: sample.hipCenter.y,
    };
    this.warnings = this.buildWarnings(isAligned);

    if (!isAligned) {
      this.phase = 'invalid_form';
      return this.getState();
    }

    switch (this.phase) {
      case 'tracking_lost':
      case 'setup_needed':
      case 'invalid_form':
        this.phase = reachedTop ? 'top' : 'setup_needed';
        break;

      case 'top':
        if (!reachedTop) {
          this.phase = 'descending';
        }
        break;

      case 'descending':
        if (reachedBottom) {
          this.phase = 'bottom';
          this.bottomEnteredAt = frame.timestampMs;
        } else if (reachedTop) {
          this.recordPartialRep(frame.timestampMs, alignmentScore);
          this.phase = 'top';
        }
        break;

      case 'bottom':
        if (
          this.bottomEnteredAt !== undefined &&
          frame.timestampMs - this.bottomEnteredAt < this.config.minBottomHoldMs
        ) {
          break;
        }

        if (!reachedBottom) {
          this.phase = 'ascending';
        }
        break;

      case 'ascending':
        if (reachedTop) {
          this.recordValidRep(frame.timestampMs, alignmentScore);
          this.phase = 'top';
        } else if (reachedBottom) {
          this.phase = 'bottom';
          this.bottomEnteredAt = frame.timestampMs;
        }
        break;
    }

    return this.getState();
  }

  public reset(): void {
    this.phase = 'setup_needed';
    this.reps = 0;
    this.validReps = 0;
    this.partialReps = 0;
    this.lastRep = undefined;
    this.bottomEnteredAt = undefined;
    this.lowestElbowAngle = 180;
    this.warnings = [];
    this.metrics = {};
  }

  public getState(): ExerciseDetectorState {
    return {
      exerciseType: this.exerciseType,
      phase: this.phase,
      reps: this.reps,
      validReps: this.validReps,
      partialReps: this.partialReps,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }

  private buildWarnings(isAligned: boolean): FormWarning[] {
    const warnings: FormWarning[] = [];

    if (!isAligned) {
      warnings.push({
        code: 'body_alignment',
        message: 'Keep shoulders, hips, and ankles in a straighter line.',
      });
    }

    if (this.config.cameraAngle === 'front_diagonal') {
      warnings.push({
        code: 'camera_angle_experimental',
        message: 'Side view is more reliable for push-up depth and body alignment.',
      });
    }

    return warnings;
  }

  private recordValidRep(timestampMs: number, alignmentScore: number): void {
    this.reps += 1;
    this.validReps += 1;
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      qualityScore: Math.round((alignmentScore + this.depthScore()) * 50),
      depthScore: this.depthScore(),
      alignmentScore,
      warnings: this.warnings,
    };
    this.lowestElbowAngle = 180;
    this.bottomEnteredAt = undefined;
  }

  private recordPartialRep(timestampMs: number, alignmentScore: number): void {
    this.reps += 1;
    this.partialReps += 1;
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      qualityScore: Math.round(alignmentScore * 50),
      depthScore: this.depthScore(),
      alignmentScore,
      warnings: [
        ...this.warnings,
        {
          code: 'partial_depth',
          message: 'Lower until your elbows bend closer to the configured bottom depth.',
        },
      ],
    };
    this.lowestElbowAngle = 180;
    this.bottomEnteredAt = undefined;
  }

  private depthScore(): number {
    const depthRange = this.config.topElbowAngle - this.config.bottomElbowAngle;

    if (depthRange <= 0) {
      return 0;
    }

    return clamp01((this.config.topElbowAngle - this.lowestElbowAngle) / depthRange);
  }
}

interface PushUpSample {
  readonly leftElbowAngle: number;
  readonly rightElbowAngle: number;
  readonly leftBodyLineDeviation: number;
  readonly rightBodyLineDeviation: number;
  readonly shoulderCenter: PoseLandmark;
  readonly hipCenter: PoseLandmark;
}

function readPushUpSample(frame: PoseFrame): PushUpSample {
  const leftShoulder = mustGet(frame, 'left_shoulder');
  const leftElbow = mustGet(frame, 'left_elbow');
  const leftWrist = mustGet(frame, 'left_wrist');
  const leftHip = mustGet(frame, 'left_hip');
  const leftAnkle = mustGet(frame, 'left_ankle');
  const rightShoulder = mustGet(frame, 'right_shoulder');
  const rightElbow = mustGet(frame, 'right_elbow');
  const rightWrist = mustGet(frame, 'right_wrist');
  const rightHip = mustGet(frame, 'right_hip');
  const rightAnkle = mustGet(frame, 'right_ankle');

  return {
    leftElbowAngle: angleDegrees(leftShoulder, leftElbow, leftWrist),
    rightElbowAngle: angleDegrees(rightShoulder, rightElbow, rightWrist),
    leftBodyLineDeviation: lineDeviationRatio(leftShoulder, leftHip, leftAnkle),
    rightBodyLineDeviation: lineDeviationRatio(rightShoulder, rightHip, rightAnkle),
    shoulderCenter: {
      ...leftShoulder,
      ...midpoint(leftShoulder, rightShoulder),
    },
    hipCenter: {
      ...leftHip,
      ...midpoint(leftHip, rightHip),
    },
  };
}

function mustGet(frame: PoseFrame, name: LandmarkName): PoseLandmark {
  const landmark = frame.landmarks.get(name);

  if (!landmark) {
    throw new Error(`Missing required landmark: ${name}`);
  }

  return landmark;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const trackingLostWarning: FormWarning = {
  code: 'tracking_lost',
  message: 'Move fully into frame so the app can track your body.',
};

const lowConfidenceWarning: FormWarning = {
  code: 'low_confidence',
  message: 'Tracking confidence is low. Improve lighting or adjust camera placement.',
};
