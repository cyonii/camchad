import type {
  CameraAngle,
  FormWarning,
  MovementInterpreter,
  MovementInterpreterState,
  MovementRecognition,
  RepEvent,
} from './movement-interpreter.js';
import { CyclicPhaseMachine } from './cyclic-phase-machine.js';
import { extractBodyState } from './body-state.js';
import { MovementTemporalTracker } from './movement-temporal-tracker.js';
import { extractPoseMovementFeatures } from './pose-movement-features.js';

export interface SquatMovementInterpreterConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topKneeAngle: number;
  readonly bottomKneeAngle: number;
  readonly maxTorsoInclinationDegrees: number;
  readonly minBottomHoldMs: number;
  readonly minPhaseVelocityDegPerSecond: number;
  readonly phaseHysteresisDegrees: number;
}

export const defaultSquatConfig: SquatMovementInterpreterConfig = {
  cameraAngle: 'side',
  minVisibility: 0.45,
  topKneeAngle: 154,
  bottomKneeAngle: 112,
  maxTorsoInclinationDegrees: 38,
  minBottomHoldMs: 80,
  minPhaseVelocityDegPerSecond: 12,
  phaseHysteresisDegrees: 8,
};

export class SquatMovementInterpreter implements MovementInterpreter {
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

  public constructor(private readonly config: SquatMovementInterpreterConfig = defaultSquatConfig) {
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
    const features = extractPoseMovementFeatures(frame, this.config.minVisibility);

    if (!bodyState || !features || features.averageKneeAngle === undefined) {
      this.temporalTracker.addMissing(frame.timestampMs);
      this.phaseMachine.setPhase('tracking_lost');
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    if (features.bodyOrientation === 'horizontal' || bodyState.orientation.kind === 'floor') {
      this.phaseMachine.setPhase('setup_needed');
      this.warnings = [];
      this.recognition = {
        confidence: 0.12,
        status: 'candidate',
        evidence: ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    const kneeAngle = features.averageKneeAngle;
    const torsoInclination = features.torsoInclinationDegrees ?? 0;
    const postureScore = clamp01(1 - torsoInclination / this.config.maxTorsoInclinationDegrees);
    const hasPostureWarning = torsoInclination > this.config.maxTorsoInclinationDegrees;
    const rawMovementConfidence = movementConfidence(
      features.movementConfidence,
      features.bodyOrientationScore,
      bodyState.orientation.confidence,
    );
    const temporalSnapshot = this.temporalTracker.add(bodyState, rawMovementConfidence);
    const kneeVelocity = this.temporalTracker.signalVelocity((state) =>
      averagedDefined(state.jointAngles.leftKnee, state.jointAngles.rightKnee),
    );
    const kneeStats = this.temporalTracker.signalStats((state) =>
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

    this.lowestKneeAngle = Math.min(this.lowestKneeAngle, kneeAngle);
    this.metrics = {
      primaryJointAngle: kneeAngle,
      primaryJointRange,
      kneeAngle,
      rangeOfMotionScore: this.depthScore(),
      depthDeficitDegrees: Math.max(0, this.lowestKneeAngle - this.config.bottomKneeAngle),
      postureScore,
      standingRecoveryScore,
      torsoInclinationRange: torsoInclinationStats.range,
      centerOfMassTravelRatio: centerOfMassTravelStats.range,
      lowerBodyCoverage: bodyState.coverage.lowerBody,
      movementConfidence: rawMovementConfidence,
      temporalMovementConfidence: temporalSnapshot.confidence.confidence,
      poseConfidence: features.poseConfidence,
      torsoInclination,
      kneeLiftRatio: features.kneeLiftRatio ?? 0,
      sampleWindowMs: temporalSnapshot.window.durationMs,
      missingSampleRatio: temporalSnapshot.window.missingSampleRatio,
      primaryJointVelocity: kneeVelocityValue,
      phaseVelocity: kneeVelocityValue,
      temporalStabilityScore: clamp01(
        1 - temporalSnapshot.window.missingSampleRatio - torsoInclination / 90,
      ),
    };
    this.warnings = this.buildWarnings(hasPostureWarning);

    const transition = this.phaseMachine.update({
      signal: kneeAngle,
      timestampMs: features.timestampMs,
      isDescendingSignal,
      isAscendingSignal,
    });

    if (transition.completedRep === 'valid') {
      this.recordValidRep(features.timestampMs, postureScore);
    } else if (transition.completedRep === 'partial') {
      this.recordPartialRep(features.timestampMs, postureScore);
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
      reps: this.reps,
      validReps: this.validReps,
      partialReps: this.partialReps,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }

  private buildWarnings(hasPostureWarning: boolean): FormWarning[] {
    const warnings: FormWarning[] = [];

    if (hasPostureWarning) {
      warnings.push({
        code: 'posture_alignment',
        message: 'Keep your torso controlled and avoid collapsing forward.',
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
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      qualityScore: Math.round((postureScore + this.depthScore()) * 50),
      depthScore: this.depthScore(),
      alignmentScore: postureScore,
      warnings: this.warnings,
    };
    this.lowestKneeAngle = 180;
  }

  private recordPartialRep(timestampMs: number, postureScore: number): void {
    this.reps += 1;
    this.partialReps += 1;
    this.lastRep = {
      repNumber: this.reps,
      timestampMs,
      qualityScore: Math.round(postureScore * 50),
      depthScore: this.depthScore(),
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

  private depthScore(): number {
    const depthRange = this.config.topKneeAngle - this.config.bottomKneeAngle;

    if (depthRange <= 0) {
      return 0;
    }

    return clamp01((this.config.topKneeAngle - this.lowestKneeAngle) / depthRange);
  }
}

function movementConfidence(
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

const trackingLostRecognition: MovementRecognition = {
  confidence: 0,
  status: 'tracking_lost',
  evidence: [],
};

const trackingLostWarning: FormWarning = {
  code: 'tracking_lost',
  message: 'Move fully into frame so the app can track your body.',
};
