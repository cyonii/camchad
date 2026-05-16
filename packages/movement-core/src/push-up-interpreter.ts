import {
  angleDegrees,
  lineDeviationRatio,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';

import type {
  CameraAngle,
  MovementInterpreter,
  MovementInterpreterState,
  MovementRecognition,
  FormWarning,
  RepEvent,
} from './movement-interpreter.js';
import { CyclicPhaseMachine } from './cyclic-phase-machine.js';
import { extractBodyState, type BodyState } from './body-state.js';
import { MovementTemporalTracker } from './movement-temporal-tracker.js';
import { extractPoseMovementFeatures } from './pose-movement-features.js';

export interface PushUpMovementInterpreterConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topElbowAngle: number;
  readonly bottomElbowAngle: number;
  readonly maxBodyLineDeviation: number;
  readonly maxInvalidBodyLineDeviation: number;
  readonly minBottomHoldMs: number;
  readonly minPhaseVelocityDegPerSecond: number;
  readonly phaseHysteresisDegrees: number;
}

export const defaultPushUpConfig: PushUpMovementInterpreterConfig = {
  cameraAngle: 'side',
  minVisibility: 0.45,
  topElbowAngle: 148,
  bottomElbowAngle: 122,
  maxBodyLineDeviation: 0.16,
  maxInvalidBodyLineDeviation: 0.28,
  minBottomHoldMs: 80,
  minPhaseVelocityDegPerSecond: 12,
  phaseHysteresisDegrees: 8,
};

export class PushUpMovementInterpreter implements MovementInterpreter {
  public readonly movementType = 'push_up';

  private reps = 0;
  private validReps = 0;
  private partialReps = 0;
  private lastRep?: RepEvent;
  private lowestElbowAngle = 180;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;
  private readonly phaseMachine: CyclicPhaseMachine;
  private readonly temporalTracker = new MovementTemporalTracker({
    windowMaxAgeMs: 1200,
    confidence: {
      activationThreshold: 0.7,
      deactivationThreshold: 0.42,
      candidateThreshold: 0.48,
      riseAlpha: 0.6,
      fallAlpha: 0.45,
    },
  });

  public constructor(
    private readonly config: PushUpMovementInterpreterConfig = defaultPushUpConfig,
  ) {
    this.phaseMachine = new CyclicPhaseMachine({
      topThreshold: config.topElbowAngle,
      bottomThreshold: config.bottomElbowAngle,
      hysteresis: config.phaseHysteresisDegrees,
      minBottomHoldMs: config.minBottomHoldMs,
    });
  }

  public processPose(frame: PoseFrame | undefined): MovementInterpreterState {
    if (!frame) {
      this.temporalTracker.addMissing();
      this.phaseMachine.setPhase('tracking_lost');
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const bodyState = extractBodyState(frame);
    const features = extractPoseMovementFeatures(frame, this.config.minVisibility);

    const trackingSide = selectTrackingSide(frame, this.config.minVisibility);

    if (!bodyState || !trackingSide) {
      this.temporalTracker.addMissing(frame.timestampMs);
      this.phaseMachine.setPhase('tracking_lost');
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
    const rawMovementConfidence = movementConfidence(
      frame.confidence,
      trackingSide.visibilityScore,
      bodyState.orientation.confidence,
    );
    const temporalSnapshot = this.temporalTracker.add(bodyState, rawMovementConfidence);
    const elbowVelocity = this.temporalTracker.signalVelocity((state) =>
      trackingSide.side === 'left' ? state.jointAngles.leftElbow : state.jointAngles.rightElbow,
    );
    const elbowStats = this.temporalTracker.signalStats((state) =>
      trackingSide.side === 'left' ? state.jointAngles.leftElbow : state.jointAngles.rightElbow,
    );
    const shoulderTravelStats = this.temporalTracker.signalStats((state) =>
      normalizedLandmarkY(state, `${trackingSide.side}_shoulder` as LandmarkName),
    );
    const hipTravelStats = this.temporalTracker.signalStats((state) =>
      normalizedLandmarkY(state, `${trackingSide.side}_hip` as LandmarkName),
    );
    const elbowVelocityValue = elbowVelocity?.valuePerSecond ?? 0;
    const isDescendingSignal =
      elbowVelocity?.direction === 'decreasing' &&
      Math.abs(elbowVelocityValue) >= this.config.minPhaseVelocityDegPerSecond;
    const isAscendingSignal =
      elbowVelocity?.direction === 'increasing' &&
      Math.abs(elbowVelocityValue) >= this.config.minPhaseVelocityDegPerSecond;
    const primaryJointRange = elbowStats.range;
    const wristShoulderOffsetRatio = Math.abs(sample.wrist.x - sample.shoulder.x) / bodyState.scale;
    const lockoutScore = jointLockoutScore(
      elbowAngle,
      this.config.bottomElbowAngle,
      this.config.topElbowAngle,
    );

    this.lowestElbowAngle = Math.min(this.lowestElbowAngle, elbowAngle);
    this.metrics = {
      elbowAngle,
      primaryJointAngle: elbowAngle,
      primaryJointRange,
      bodyLineDeviation,
      bodyLineScore: alignmentScore,
      alignmentScore,
      lockoutScore,
      rangeOfMotionScore: this.depthScore(),
      depthDeficitDegrees: Math.max(0, this.lowestElbowAngle - this.config.bottomElbowAngle),
      shoulderTravelRatio: shoulderTravelStats.range,
      hipTravelRatio: hipTravelStats.range,
      wristShoulderOffsetRatio,
      handStackScore: clamp01(1 - wristShoulderOffsetRatio / 1.4),
      hipSagRatio: Math.abs(sample.hip.y - sample.shoulder.y) / bodyState.scale,
      poseConfidence: frame.confidence,
      movementConfidence: rawMovementConfidence,
      temporalMovementConfidence: temporalSnapshot.confidence.confidence,
      sampleWindowMs: temporalSnapshot.window.durationMs,
      missingSampleRatio: temporalSnapshot.window.missingSampleRatio,
      primaryJointVelocity: elbowVelocityValue,
      phaseVelocity: elbowVelocityValue,
      temporalStabilityScore: clamp01(
        1 - temporalSnapshot.window.missingSampleRatio - bodyLineDeviation,
      ),
      trackingSide: trackingSide.side === 'left' ? 0 : 1,
      shoulderY: sample.shoulder.y,
      hipY: sample.hip.y,
    };
    this.warnings = this.buildWarnings(hasAlignmentWarning);

    if (hasInvalidAlignment) {
      this.phaseMachine.setPhase('invalid_form');
      this.recognition = this.buildRecognition('active');
      return this.getState();
    }

    if (features?.bodyOrientation === 'vertical' || bodyState.orientation.kind === 'standing') {
      this.phaseMachine.setPhase('setup_needed');
      this.warnings = [];
      this.recognition = {
        confidence: 0.12,
        status: 'candidate',
        evidence: ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    const transition = this.phaseMachine.update({
      signal: elbowAngle,
      timestampMs: frame.timestampMs,
      isDescendingSignal,
      isAscendingSignal,
    });

    if (transition.completedRep === 'valid') {
      this.recordValidRep(frame.timestampMs, alignmentScore);
    } else if (transition.completedRep === 'partial') {
      this.recordPartialRep(frame.timestampMs, alignmentScore);
    }

    this.recognition = this.buildRecognition(
      this.phaseMachine.phase === 'setup_needed' || temporalSnapshot.confidence.state !== 'active'
        ? 'candidate'
        : 'active',
    );

    return this.getState();
  }

  public reset(): void {
    this.phaseMachine.reset();
    this.reps = 0;
    this.validReps = 0;
    this.partialReps = 0;
    this.lastRep = undefined;
    this.lowestElbowAngle = 180;
    this.warnings = [];
    this.metrics = {};
    this.recognition = trackingLostRecognition;
    this.temporalTracker.reset();
  }

  public getState(): MovementInterpreterState {
    return {
      movementType: this.movementType,
      recognition: this.recognition,
      phase: this.phaseMachine.phase,
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
  readonly wrist: PoseLandmark;
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
    wrist,
    hip,
  };
}

function normalizedLandmarkY(state: BodyState, name: LandmarkName): number | undefined {
  return state.landmarks.get(name)?.normalizedY;
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

function jointLockoutScore(angle: number, bottomAngle: number, topAngle: number): number {
  const range = topAngle - bottomAngle;

  if (range <= 0) {
    return 0;
  }

  return clamp01((angle - bottomAngle) / range);
}

function movementConfidence(
  poseConfidence: number,
  trackingVisibility: number,
  orientationConfidence: number,
): number {
  return clamp01(poseConfidence * 0.46 + trackingVisibility * 0.36 + orientationConfidence * 0.18);
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
