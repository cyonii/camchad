import {
  angleDegrees,
  lineDeviationRatio,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@home-activity/pose-core';

import type {
  CameraAngle,
  MovementInterpreter,
  MovementPhase,
  MovementInterpreterState,
  MovementRecognition,
  FormWarning,
  RepEvent,
} from './movement-interpreter.js';

export interface PushUpMovementInterpreterConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topElbowAngle: number;
  readonly bottomElbowAngle: number;
  readonly maxBodyLineDeviation: number;
  readonly maxInvalidBodyLineDeviation: number;
  readonly minBottomHoldMs: number;
}

export const defaultPushUpConfig: PushUpMovementInterpreterConfig = {
  cameraAngle: 'side',
  minVisibility: 0.45,
  topElbowAngle: 148,
  bottomElbowAngle: 122,
  maxBodyLineDeviation: 0.16,
  maxInvalidBodyLineDeviation: 0.28,
  minBottomHoldMs: 80,
};

export class PushUpMovementInterpreter implements MovementInterpreter {
  public readonly movementType = 'push_up';

  private phase: MovementPhase = 'setup_needed';
  private reps = 0;
  private validReps = 0;
  private partialReps = 0;
  private lastRep?: RepEvent;
  private bottomEnteredAt?: number;
  private lowestElbowAngle = 180;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;

  public constructor(
    private readonly config: PushUpMovementInterpreterConfig = defaultPushUpConfig,
  ) {}

  public processPose(frame: PoseFrame | undefined): MovementInterpreterState {
    if (!frame) {
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const trackingSide = selectTrackingSide(frame, this.config.minVisibility);

    if (!trackingSide) {
      this.phase = 'tracking_lost';
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const sample = readPushUpSample(frame, trackingSide.side);
    const elbowAngle = sample.elbowAngle;
    const bodyLineDeviation = sample.bodyLineDeviation;
    const alignmentScore = clamp01(1 - bodyLineDeviation / this.config.maxBodyLineDeviation);
    const hasAlignmentWarning = bodyLineDeviation > this.config.maxBodyLineDeviation;
    const hasInvalidAlignment = bodyLineDeviation > this.config.maxInvalidBodyLineDeviation;
    const reachedBottom = elbowAngle <= this.config.bottomElbowAngle;
    const reachedTop = elbowAngle >= this.config.topElbowAngle;

    this.lowestElbowAngle = Math.min(this.lowestElbowAngle, elbowAngle);
    this.metrics = {
      elbowAngle,
      bodyLineDeviation,
      alignmentScore,
      poseConfidence: frame.confidence,
      movementConfidence: movementConfidence(frame.confidence, trackingSide.visibilityScore),
      trackingSide: trackingSide.side === 'left' ? 0 : 1,
      shoulderY: sample.shoulder.y,
      hipY: sample.hip.y,
    };
    this.warnings = this.buildWarnings(hasAlignmentWarning);

    if (hasInvalidAlignment) {
      this.phase = 'invalid_form';
      this.recognition = this.buildRecognition('active');
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

    this.recognition = this.buildRecognition(
      this.phase === 'setup_needed' ? 'candidate' : 'active',
    );

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
    this.recognition = trackingLostRecognition;
  }

  public getState(): MovementInterpreterState {
    return {
      movementType: this.movementType,
      recognition: this.recognition,
      phase: this.phase,
      reps: this.reps,
      validReps: this.validReps,
      partialReps: this.partialReps,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }

  private buildWarnings(hasAlignmentWarning: boolean): FormWarning[] {
    const warnings: FormWarning[] = [];

    if (hasAlignmentWarning) {
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

  private buildRecognition(status: MovementRecognition['status']): MovementRecognition {
    return {
      movementType: this.movementType,
      confidence: this.metrics.movementConfidence ?? 0,
      status,
      evidence: ['side_landmark_visibility', 'elbow_flexion_signal', 'body_line_signal'],
    };
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
  readonly elbowAngle: number;
  readonly bodyLineDeviation: number;
  readonly shoulder: PoseLandmark;
  readonly hip: PoseLandmark;
}

type TrackingSide = 'left' | 'right';

interface TrackingSideSelection {
  readonly side: TrackingSide;
  readonly visibilityScore: number;
}

function readPushUpSample(frame: PoseFrame, side: TrackingSide): PushUpSample {
  const shoulder = mustGet(frame, `${side}_shoulder` as LandmarkName);
  const elbow = mustGet(frame, `${side}_elbow` as LandmarkName);
  const wrist = mustGet(frame, `${side}_wrist` as LandmarkName);
  const hip = mustGet(frame, `${side}_hip` as LandmarkName);
  const ankle = mustGet(frame, `${side}_ankle` as LandmarkName);

  return {
    elbowAngle: angleDegrees(shoulder, elbow, wrist),
    bodyLineDeviation: lineDeviationRatio(shoulder, hip, ankle),
    shoulder,
    hip,
  };
}

function selectTrackingSide(
  frame: PoseFrame,
  minVisibility: number,
): TrackingSideSelection | undefined {
  const leftScore = sideVisibilityScore(frame, 'left', minVisibility);
  const rightScore = sideVisibilityScore(frame, 'right', minVisibility);

  if (leftScore === undefined && rightScore === undefined) {
    return undefined;
  }

  if (rightScore === undefined) {
    return { side: 'left', visibilityScore: leftScore ?? 0 };
  }

  if (leftScore === undefined) {
    return { side: 'right', visibilityScore: rightScore };
  }

  return leftScore >= rightScore
    ? { side: 'left', visibilityScore: leftScore }
    : { side: 'right', visibilityScore: rightScore };
}

function sideVisibilityScore(
  frame: PoseFrame,
  side: TrackingSide,
  minVisibility: number,
): number | undefined {
  const landmarks = [
    frame.landmarks.get(`${side}_shoulder`),
    frame.landmarks.get(`${side}_elbow`),
    frame.landmarks.get(`${side}_wrist`),
    frame.landmarks.get(`${side}_hip`),
    frame.landmarks.get(`${side}_ankle`),
  ];

  if (landmarks.some((landmark) => !landmark || landmarkVisibility(landmark) < minVisibility)) {
    return undefined;
  }

  return (
    landmarks.reduce((sum, landmark) => sum + landmarkVisibility(landmark), 0) / landmarks.length
  );
}

function mustGet(frame: PoseFrame, name: LandmarkName): PoseLandmark {
  const landmark = frame.landmarks.get(name);

  if (!landmark) {
    throw new Error(`Missing required landmark: ${name}`);
  }

  return landmark;
}

function landmarkVisibility(landmark: PoseLandmark | undefined): number {
  return landmark?.visibility ?? landmark?.presence ?? 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function movementConfidence(poseConfidence: number, trackingVisibility: number): number {
  return clamp01(poseConfidence * 0.55 + trackingVisibility * 0.45);
}

const trackingLostRecognition: MovementRecognition = {
  confidence: 0,
  status: 'tracking_lost',
  evidence: [],
};

const trackingLostWarning: FormWarning = {
  code: 'tracking_lost',
  message: 'Move fully into frame so the app can track your body.',
};

const lowConfidenceWarning: FormWarning = {
  code: 'low_confidence',
  message: 'Tracking confidence is low. Improve lighting or adjust camera placement.',
};
