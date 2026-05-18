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
  MovementStateKind,
  FormWarning,
  RepEvent,
} from './movement-interpreter.js';
import { CyclicPhaseMachine } from './cyclic-phase-machine.js';
import { extractBodyState, type BodyState } from './body-state.js';
import { MovementTemporalTracker } from './movement-temporal-tracker.js';
import { bodyKneeLiftRatio, bodyMaxKneeLiftRatio } from './movement-profile-signals.js';
import type { MovementWindowSnapshot } from './movement-window.js';
import { buildRepQualityComponents, trackingQualityFromMetrics } from './rep-quality.js';

interface FloorPressValidationConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topElbowAngle: number;
  readonly bottomElbowAngle: number;
  readonly maxBodyLineDeviation: number;
  readonly maxInvalidBodyLineDeviation: number;
  readonly maxHandStackOffsetRatio: number;
  readonly maxInvalidHandStackOffsetRatio: number;
  readonly minBottomHoldMs: number;
  readonly minPhaseVelocityDegPerSecond: number;
  readonly phaseHysteresisDegrees: number;
}

const floorBodyLineValidationConfig: FloorPressValidationConfig = {
  cameraAngle: 'side',
  minVisibility: 0.45,
  topElbowAngle: 148,
  bottomElbowAngle: 122,
  maxBodyLineDeviation: 0.16,
  maxInvalidBodyLineDeviation: 0.28,
  maxHandStackOffsetRatio: 1.1,
  maxInvalidHandStackOffsetRatio: 1.55,
  minBottomHoldMs: 80,
  minPhaseVelocityDegPerSecond: 12,
  phaseHysteresisDegrees: 8,
};

class FloorBodyLineValidationInterpreter implements MovementInterpreter {
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
    private readonly config: FloorPressValidationConfig = floorBodyLineValidationConfig,
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

    const trackingSide = selectTrackingSide(frame, this.config.minVisibility);

    if (!bodyState || !trackingSide) {
      this.temporalTracker.addMissing(frame.timestampMs);
      this.phaseMachine.setPhase('tracking_lost');
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const sample = readFloorBodyLineSample(frame, trackingSide.side);
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
    const elbowRhythm = this.temporalTracker.signalRhythm((state) =>
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
    const hasHandPositionWarning = wristShoulderOffsetRatio > this.config.maxHandStackOffsetRatio;
    const hasInvalidHandPosition =
      wristShoulderOffsetRatio > this.config.maxInvalidHandStackOffsetRatio;
    const lockoutScore = jointLockoutScore(
      elbowAngle,
      this.config.bottomElbowAngle,
      this.config.topElbowAngle,
    );
    const confidenceDecay = confidenceDecayFor(temporalSnapshot.window);
    const depthDriftDegrees = Math.max(0, elbowStats.min - this.config.bottomElbowAngle);
    const alignmentDegradation = clamp01(1 - alignmentScore);

    this.lowestElbowAngle = Math.min(this.lowestElbowAngle, elbowAngle);
    this.metrics = {
      elbowAngle,
      primaryJointAngle: elbowAngle,
      primaryJointRange,
      rhythmScore: elbowRhythm.rhythmScore,
      rhythmCycleCount: elbowRhythm.cycleCount,
      averageCycleMs: elbowRhythm.averageCycleMs ?? 0,
      tempoDriftRatio: elbowRhythm.tempoDriftRatio,
      tempoDriftMs: elbowRhythm.cycleDurationRangeMs,
      bodyLineDeviation,
      bodyLineScore: alignmentScore,
      alignmentScore,
      alignmentDegradation,
      lockoutScore,
      rangeOfMotionScore: this.rangeScore(),
      depthDeficitDegrees: Math.max(0, this.lowestElbowAngle - this.config.bottomElbowAngle),
      depthDriftDegrees,
      confidenceDecay,
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
      bottomHoldMs: this.phaseMachine.lastBottomHoldMs,
      fatigueScore: fatigueScore({
        confidenceDecay,
        depthDriftRatio: clamp01(depthDriftDegrees / 45),
        tempoDriftRatio: elbowRhythm.tempoDriftRatio,
        alignmentDegradation,
      }),
      trackingSide: trackingSide.side === 'left' ? 0 : 1,
      shoulderY: sample.shoulder.y,
      hipY: sample.hip.y,
    };
    this.warnings = this.buildWarnings({
      hasAlignmentWarning,
      hasHandPositionWarning,
    });

    if (hasInvalidAlignment || hasInvalidHandPosition) {
      this.phaseMachine.setPhase('invalid_form');
      this.recognition = this.buildRecognition('active');
      return this.getState();
    }

    if (bodyState.orientation.kind === 'standing' || bodyState.orientation.kind === 'hanging') {
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

    if (transition.bottomHoldMs !== undefined) {
      this.metrics = {
        ...this.metrics,
        bottomHoldMs: transition.bottomHoldMs,
      };
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
      stateKind: stateKindFor(this.phaseMachine.phase, this.lastRep),
      reps: this.reps,
      validReps: this.validReps,
      partialReps: this.partialReps,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }

  private buildWarnings(input: {
    readonly hasAlignmentWarning: boolean;
    readonly hasHandPositionWarning: boolean;
  }): FormWarning[] {
    const warnings: FormWarning[] = [];

    if (input.hasAlignmentWarning) {
      warnings.push({
        code: 'body_alignment',
        message: 'Keep shoulders, hips, and ankles in a straighter line.',
      });
    }

    if (input.hasHandPositionWarning) {
      warnings.push({
        code: 'hand_position',
        message: 'Stack hands closer under the shoulders so depth and lockout stay measurable.',
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
    const rangeScore = this.rangeScore();
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      ...buildRepQualityComponents({
        rangeScore,
        alignmentScore,
        rhythmScore: this.metrics.rhythmScore,
        confidenceScore: this.metrics.temporalMovementConfidence ?? this.metrics.movementConfidence,
        trackingQualityScore: trackingQualityFromMetrics(this.metrics),
      }),
      alignmentScore,
      warnings: this.warnings,
    };
    this.lowestElbowAngle = 180;
  }

  private recordPartialRep(timestampMs: number, alignmentScore: number): void {
    this.reps += 1;
    this.partialReps += 1;
    const rangeScore = this.rangeScore();
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      ...buildRepQualityComponents({
        rangeScore,
        alignmentScore,
        rhythmScore: this.metrics.rhythmScore,
        confidenceScore: this.metrics.temporalMovementConfidence ?? this.metrics.movementConfidence,
        trackingQualityScore: trackingQualityFromMetrics(this.metrics),
      }),
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

  private rangeScore(): number {
    const depthRange = this.config.topElbowAngle - this.config.bottomElbowAngle;

    if (depthRange <= 0) {
      return 0;
    }

    return clamp01((this.config.topElbowAngle - this.lowestElbowAngle) / depthRange);
  }
}

export type RepValidatingMovementType = 'push_up' | 'squat';

export function createRepValidatingMovementInterpreter(
  movementType: RepValidatingMovementType,
  options: { readonly cameraAngle?: CameraAngle } = {},
): MovementInterpreter {
  switch (movementType) {
    case 'push_up':
      return new FloorBodyLineValidationInterpreter({
        ...floorBodyLineValidationConfig,
        cameraAngle: options.cameraAngle ?? floorBodyLineValidationConfig.cameraAngle,
      });
    case 'squat':
      return new StandingKneeBendValidationInterpreter({
        ...standingKneeBendValidationConfig,
        cameraAngle: options.cameraAngle ?? standingKneeBendValidationConfig.cameraAngle,
      });
  }
}

function stateKindFor(
  phase: MovementInterpreterState['phase'],
  lastRep: RepEvent | undefined,
): MovementStateKind {
  if (phase === 'tracking_lost') {
    return 'tracking_lost';
  }

  if (phase === 'invalid_form') {
    return 'failed_rep';
  }

  if (phase === 'top' && lastRep?.warnings.some((warning) => warning.code === 'partial_depth')) {
    return 'partial_rep';
  }

  if (phase === 'descending' || phase === 'bottom' || phase === 'ascending') {
    return 'active_rep';
  }

  return 'setup';
}

interface FloorBodyLineSample {
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

function readFloorBodyLineSample(frame: PoseFrame, side: TrackingSide): FloorBodyLineSample {
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

function confidenceDecayFor(window: MovementWindowSnapshot): number {
  const first = window.validSamples[0]?.bodyState.confidence;
  const latest = window.latestValid?.bodyState.confidence;

  if (first === undefined || latest === undefined) {
    return 0;
  }

  return Math.max(0, first - latest);
}

function fatigueScore(metrics: {
  readonly confidenceDecay: number;
  readonly depthDriftRatio: number;
  readonly tempoDriftRatio: number;
  readonly alignmentDegradation: number;
}): number {
  return clamp01(
    metrics.confidenceDecay * 0.22 +
      metrics.depthDriftRatio * 0.3 +
      metrics.tempoDriftRatio * 0.18 +
      metrics.alignmentDegradation * 0.3,
  );
}

const lowConfidenceWarning: FormWarning = {
  code: 'low_confidence',
  message: 'Tracking confidence is low. Improve lighting or adjust camera placement.',
};

interface StandingKneeBendValidationConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topKneeAngle: number;
  readonly bottomKneeAngle: number;
  readonly maxTorsoInclinationDegrees: number;
  readonly maxKneeLiftRatio: number;
  readonly maxSplitStanceRatio: number;
  readonly maxHingeInclinationDegrees: number;
  readonly minHingeKneeAngle: number;
  readonly minLowerBodyCoverage: number;
  readonly minBottomHoldMs: number;
  readonly minPhaseVelocityDegPerSecond: number;
  readonly phaseHysteresisDegrees: number;
}

const standingKneeBendValidationConfig: StandingKneeBendValidationConfig = {
  cameraAngle: 'side',
  minVisibility: 0.45,
  topKneeAngle: 154,
  bottomKneeAngle: 112,
  maxTorsoInclinationDegrees: 38,
  maxKneeLiftRatio: 0.06,
  maxSplitStanceRatio: 1.2,
  maxHingeInclinationDegrees: 45,
  minHingeKneeAngle: 142,
  minLowerBodyCoverage: 0.58,
  minBottomHoldMs: 80,
  minPhaseVelocityDegPerSecond: 12,
  phaseHysteresisDegrees: 8,
};

class StandingKneeBendValidationInterpreter implements MovementInterpreter {
  public readonly movementType = 'squat';

  private reps = 0;
  private validReps = 0;
  private partialReps = 0;
  private lastRep?: RepEvent;
  private lowestKneeAngle = 180;
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
    private readonly config: StandingKneeBendValidationConfig = standingKneeBendValidationConfig,
  ) {
    this.phaseMachine = new CyclicPhaseMachine({
      topThreshold: config.topKneeAngle,
      bottomThreshold: config.bottomKneeAngle,
      hysteresis: config.phaseHysteresisDegrees,
      minBottomHoldMs: config.minBottomHoldMs,
    });
  }

  public processPose(
    frame: Parameters<MovementInterpreter['processPose']>[0],
  ): MovementInterpreterState {
    if (!frame) {
      this.temporalTracker.addMissing();
      this.phaseMachine.setPhase('tracking_lost');
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const bodyState = extractBodyState(frame);
    const kneeAngle = bodyState
      ? averagedDefined(bodyState.jointAngles.leftKnee, bodyState.jointAngles.rightKnee)
      : undefined;

    if (!bodyState || kneeAngle === undefined) {
      this.temporalTracker.addMissing(frame.timestampMs);
      this.phaseMachine.setPhase('tracking_lost');
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const torsoInclination = bodyState.geometry.torsoInclinationDegrees;

    if (bodyState.orientation.kind === 'floor') {
      this.phaseMachine.setPhase('setup_needed');
      this.warnings = [];
      this.recognition = {
        confidence: 0.12,
        status: 'candidate',
        evidence: ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    const kneeLift = bodyKneeLiftRatio(bodyState, this.config.minVisibility);
    const maxKneeLift = bodyMaxKneeLiftRatio(bodyState, this.config.minVisibility);
    const ankleSpan = bodyState.geometry.ankleSpanRatio;
    const disqualifier = squatDisqualifier(
      {
        ankleSpanRatio: ankleSpan,
        kneeLiftRatio: kneeLift,
        maxKneeLiftRatio: maxKneeLift,
      },
      kneeAngle,
      torsoInclination,
      this.config,
    );

    if (disqualifier) {
      const rawMovementConfidence = squatMovementConfidence(
        bodyState.confidence,
        bodyState.orientation.confidence,
        bodyState.orientation.confidence,
      );
      const temporalSnapshot = this.temporalTracker.add(bodyState, rawMovementConfidence * 0.35);

      this.phaseMachine.setPhase('setup_needed');
      this.metrics = {
        kneeAngle,
        primaryJointAngle: kneeAngle,
        movementConfidence: rawMovementConfidence * 0.35,
        temporalMovementConfidence: temporalSnapshot.confidence.confidence,
        poseConfidence: bodyState.confidence,
        torsoInclination,
        kneeLiftRatio: kneeLift ?? 0,
        maxKneeLiftRatio: maxKneeLift ?? 0,
        ankleSpanRatio: ankleSpan ?? 0,
      };
      this.warnings = [];
      this.recognition = {
        confidence: rawMovementConfidence * 0.35,
        status: 'candidate',
        evidence: [disqualifier],
      };
      return this.getState();
    }

    const postureScore = clamp01(1 - torsoInclination / this.config.maxTorsoInclinationDegrees);
    const hasPostureWarning = torsoInclination > this.config.maxTorsoInclinationDegrees;
    const rawMovementConfidence = squatMovementConfidence(
      bodyState.confidence,
      bodyState.orientation.confidence,
      bodyState.orientation.confidence,
    );
    const temporalSnapshot = this.temporalTracker.add(bodyState, rawMovementConfidence);
    const kneeVelocity = this.temporalTracker.signalVelocity((state) =>
      averagedDefined(state.jointAngles.leftKnee, state.jointAngles.rightKnee),
    );
    const kneeStats = this.temporalTracker.signalStats((state) =>
      averagedDefined(state.jointAngles.leftKnee, state.jointAngles.rightKnee),
    );
    const kneeRhythm = this.temporalTracker.signalRhythm((state) =>
      averagedDefined(state.jointAngles.leftKnee, state.jointAngles.rightKnee),
    );
    const torsoInclinationStats = this.temporalTracker.signalStats(
      (state) => state.geometry.torsoInclinationDegrees,
    );
    const centerOfMassTravelStats = this.temporalTracker.signalStats(
      (state) => state.geometry.centerOfMassY,
    );
    const kneeVelocityValue = kneeVelocity?.valuePerSecond ?? 0;
    const isDescendingSignal =
      kneeVelocity?.direction === 'decreasing' &&
      Math.abs(kneeVelocityValue) >= this.config.minPhaseVelocityDegPerSecond;
    const isAscendingSignal =
      kneeVelocity?.direction === 'increasing' &&
      Math.abs(kneeVelocityValue) >= this.config.minPhaseVelocityDegPerSecond;
    const primaryJointRange = kneeStats.range;
    const standingRecoveryScore = jointLockoutScore(
      kneeAngle,
      this.config.bottomKneeAngle,
      this.config.topKneeAngle,
    );
    const confidenceDecay = confidenceDecayFor(temporalSnapshot.window);
    const leftRightImbalance = jointImbalanceRatio(
      bodyState.jointAngles.leftKnee,
      bodyState.jointAngles.rightKnee,
    );
    const torsoCollapseRatio = clamp01(torsoInclination / 90);

    this.lowestKneeAngle = Math.min(this.lowestKneeAngle, kneeAngle);
    const depthDeficitDegrees = Math.max(0, this.lowestKneeAngle - this.config.bottomKneeAngle);
    const depthDriftRatio = clamp01(depthDeficitDegrees / 55);
    const fatigueSignal = squatFatigueScore({
      confidenceDecay,
      depthDriftRatio,
      tempoDriftRatio: kneeRhythm.tempoDriftRatio,
      torsoCollapseRatio,
      leftRightImbalance,
    });
    this.metrics = {
      primaryJointAngle: kneeAngle,
      primaryJointRange,
      rhythmScore: kneeRhythm.rhythmScore,
      rhythmCycleCount: kneeRhythm.cycleCount,
      averageCycleMs: kneeRhythm.averageCycleMs ?? 0,
      tempoDriftRatio: kneeRhythm.tempoDriftRatio,
      tempoDriftMs: kneeRhythm.cycleDurationRangeMs,
      kneeAngle,
      rangeOfMotionScore: this.rangeScore(),
      depthDeficitDegrees,
      depthConsistencyScore: clamp01(1 - depthDriftRatio),
      postureScore,
      torsoCollapseRatio,
      standingRecoveryScore,
      torsoInclinationRange: torsoInclinationStats.range,
      centerOfMassTravelRatio: centerOfMassTravelStats.range,
      leftRightImbalance,
      lowerBodyCoverage: bodyState.coverage.lowerBody,
      movementConfidence: rawMovementConfidence,
      temporalMovementConfidence: temporalSnapshot.confidence.confidence,
      confidenceDecay,
      poseConfidence: bodyState.confidence,
      torsoInclination,
      kneeLiftRatio: kneeLift ?? 0,
      sampleWindowMs: temporalSnapshot.window.durationMs,
      missingSampleRatio: temporalSnapshot.window.missingSampleRatio,
      primaryJointVelocity: kneeVelocityValue,
      phaseVelocity: kneeVelocityValue,
      temporalStabilityScore: clamp01(
        1 - temporalSnapshot.window.missingSampleRatio - torsoInclination / 90,
      ),
      bottomHoldMs: this.phaseMachine.lastBottomHoldMs,
      fatigueScore: fatigueSignal,
    };
    this.warnings = this.buildWarnings({
      hasPostureWarning,
      hasLowerBodyCoverageWarning: bodyState.coverage.lowerBody < this.config.minLowerBodyCoverage,
    });

    const transition = this.phaseMachine.update({
      signal: kneeAngle,
      timestampMs: bodyState.timestampMs,
      isDescendingSignal,
      isAscendingSignal,
    });

    if (transition.completedRep === 'valid') {
      this.recordValidRep(bodyState.timestampMs, postureScore);
    } else if (transition.completedRep === 'partial') {
      this.recordPartialRep(bodyState.timestampMs, postureScore);
    }

    if (transition.bottomHoldMs !== undefined) {
      this.metrics = {
        ...this.metrics,
        bottomHoldMs: transition.bottomHoldMs,
      };
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
    this.lowestKneeAngle = 180;
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
      stateKind: squatStateKindFor(this.phaseMachine.phase, this.lastRep),
      reps: this.reps,
      validReps: this.validReps,
      partialReps: this.partialReps,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }

  private buildWarnings(input: {
    readonly hasPostureWarning: boolean;
    readonly hasLowerBodyCoverageWarning: boolean;
  }): FormWarning[] {
    const warnings: FormWarning[] = [];

    if (input.hasPostureWarning) {
      warnings.push({
        code: 'posture_alignment',
        message: 'Keep your torso controlled and avoid collapsing forward.',
      });
    }

    if (input.hasLowerBodyCoverageWarning) {
      warnings.push({
        code: 'lower_body_visibility',
        message: 'Keep hips, knees, ankles, and feet visible before trusting squat depth.',
      });
    }

    if (this.config.cameraAngle !== 'side') {
      warnings.push({
        code: 'camera_angle_experimental',
        message: 'Side view is more reliable for squat depth and torso control.',
      });
    }

    return warnings;
  }

  private buildRecognition(status: MovementRecognition['status']): MovementRecognition {
    return {
      movementType: this.movementType,
      confidence: this.metrics.movementConfidence ?? 0,
      status,
      evidence: ['vertical_body_orientation', 'knee_flexion_signal', 'hip_level_change'],
    };
  }

  private recordValidRep(timestampMs: number, postureScore: number): void {
    this.reps += 1;
    this.validReps += 1;
    const rangeScore = this.rangeScore();
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      ...buildRepQualityComponents({
        rangeScore,
        alignmentScore: postureScore,
        rhythmScore: this.metrics.rhythmScore,
        confidenceScore: this.metrics.temporalMovementConfidence ?? this.metrics.movementConfidence,
        trackingQualityScore: trackingQualityFromMetrics(this.metrics),
      }),
      alignmentScore: postureScore,
      warnings: this.warnings,
    };
    this.lowestKneeAngle = 180;
  }

  private recordPartialRep(timestampMs: number, postureScore: number): void {
    this.reps += 1;
    this.partialReps += 1;
    const rangeScore = this.rangeScore();
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      ...buildRepQualityComponents({
        rangeScore,
        alignmentScore: postureScore,
        rhythmScore: this.metrics.rhythmScore,
        confidenceScore: this.metrics.temporalMovementConfidence ?? this.metrics.movementConfidence,
        trackingQualityScore: trackingQualityFromMetrics(this.metrics),
      }),
      alignmentScore: postureScore,
      warnings: [
        ...this.warnings,
        {
          code: 'range_of_motion',
          message: 'Lower through a fuller squat range before standing up.',
        },
      ],
    };
    this.lowestKneeAngle = 180;
  }

  private rangeScore(): number {
    const depthRange = this.config.topKneeAngle - this.config.bottomKneeAngle;

    if (depthRange <= 0) {
      return 0;
    }

    return clamp01((this.config.topKneeAngle - this.lowestKneeAngle) / depthRange);
  }
}

function squatStateKindFor(
  phase: MovementInterpreterState['phase'],
  lastRep: RepEvent | undefined,
): MovementStateKind {
  if (phase === 'tracking_lost') {
    return 'tracking_lost';
  }

  if (phase === 'invalid_form') {
    return 'failed_rep';
  }

  if (phase === 'top' && lastRep?.warnings.some((warning) => warning.code === 'range_of_motion')) {
    return 'partial_rep';
  }

  if (phase === 'descending' || phase === 'bottom' || phase === 'ascending') {
    return 'active_rep';
  }

  return 'setup';
}

function squatMovementConfidence(
  poseConfidence: number,
  orientationScore: number,
  bodyOrientationConfidence: number,
): number {
  return clamp01(
    poseConfidence * 0.46 + orientationScore * 0.32 + bodyOrientationConfidence * 0.22,
  );
}

function averagedDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }

  if (b === undefined) {
    return a;
  }

  return (a + b) / 2;
}

interface SquatPatternSignals {
  readonly ankleSpanRatio?: number;
  readonly kneeLiftRatio?: number;
  readonly maxKneeLiftRatio?: number;
}

function squatDisqualifier(
  signals: SquatPatternSignals,
  kneeAngle: number,
  torsoInclination: number,
  config: StandingKneeBendValidationConfig,
): string | undefined {
  if ((signals.maxKneeLiftRatio ?? signals.kneeLiftRatio ?? 0) > config.maxKneeLiftRatio) {
    return 'knee_lift_pattern_not_squat';
  }

  if ((signals.ankleSpanRatio ?? 0) > config.maxSplitStanceRatio) {
    return 'split_stance_pattern_not_squat';
  }

  if (
    torsoInclination > config.maxHingeInclinationDegrees &&
    kneeAngle >= config.minHingeKneeAngle
  ) {
    return 'hip_hinge_pattern_not_squat';
  }

  return undefined;
}

function jointImbalanceRatio(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) {
    return 0;
  }

  return clamp01(Math.abs(a - b) / 45);
}

function squatFatigueScore(metrics: {
  readonly confidenceDecay: number;
  readonly depthDriftRatio: number;
  readonly tempoDriftRatio: number;
  readonly torsoCollapseRatio: number;
  readonly leftRightImbalance: number;
}): number {
  return clamp01(
    metrics.confidenceDecay * 0.18 +
      metrics.depthDriftRatio * 0.26 +
      metrics.tempoDriftRatio * 0.18 +
      metrics.torsoCollapseRatio * 0.24 +
      metrics.leftRightImbalance * 0.14,
  );
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
