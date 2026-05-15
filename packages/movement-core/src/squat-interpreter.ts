import type {
  CameraAngle,
  FormWarning,
  MovementInterpreter,
  MovementInterpreterState,
  MovementPhase,
  MovementRecognition,
  RepEvent,
} from './movement-interpreter.js';
import { extractBodyState } from './body-state.js';
import { MovementWindow } from './movement-window.js';
import { extractPoseMovementFeatures } from './pose-movement-features.js';
import { TemporalConfidenceAccumulator } from './temporal-confidence.js';

export interface SquatMovementInterpreterConfig {
  readonly cameraAngle: CameraAngle;
  readonly minVisibility: number;
  readonly topKneeAngle: number;
  readonly bottomKneeAngle: number;
  readonly maxTorsoInclinationDegrees: number;
  readonly minBottomHoldMs: number;
}

export const defaultSquatConfig: SquatMovementInterpreterConfig = {
  cameraAngle: 'side',
  minVisibility: 0.45,
  topKneeAngle: 154,
  bottomKneeAngle: 112,
  maxTorsoInclinationDegrees: 38,
  minBottomHoldMs: 80,
};

export class SquatMovementInterpreter implements MovementInterpreter {
  public readonly movementType = 'squat';

  private phase: MovementPhase = 'setup_needed';
  private reps = 0;
  private validReps = 0;
  private partialReps = 0;
  private lastRep?: RepEvent;
  private bottomEnteredAt?: number;
  private lowestKneeAngle = 180;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;
  private lastTimestampMs?: number;
  private readonly movementWindow = new MovementWindow({ maxAgeMs: 1200 });
  private readonly recognitionConfidence = new TemporalConfidenceAccumulator({
    activationThreshold: 0.7,
    deactivationThreshold: 0.42,
    candidateThreshold: 0.48,
    riseAlpha: 0.6,
    fallAlpha: 0.45,
  });

  public constructor(
    private readonly config: SquatMovementInterpreterConfig = defaultSquatConfig,
  ) {}

  public processPose(
    frame: Parameters<MovementInterpreter['processPose']>[0],
  ): MovementInterpreterState {
    if (!frame) {
      this.movementWindow.addMissing(this.nextMissingTimestamp());
      this.recognitionConfidence.addSample(0);
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    this.lastTimestampMs = frame.timestampMs;
    const bodyState = extractBodyState(frame);
    const features = extractPoseMovementFeatures(frame, this.config.minVisibility);

    if (!bodyState || !features || features.averageKneeAngle === undefined) {
      this.movementWindow.addMissing(frame.timestampMs);
      this.recognitionConfidence.addSample(0);
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    if (features.bodyOrientation === 'horizontal' || bodyState.orientation.kind === 'floor') {
      this.phase = 'setup_needed';
      this.warnings = [];
      this.recognition = {
        confidence: 0.12,
        status: 'candidate',
        evidence: ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    const windowSnapshot = this.movementWindow.add(bodyState);
    const kneeAngle = features.averageKneeAngle;
    const kneeVelocity = this.movementWindow.signalVelocity((state) =>
      averagedDefined(state.jointAngles.leftKnee, state.jointAngles.rightKnee),
    );
    const torsoInclination = features.torsoInclinationDegrees ?? 0;
    const postureScore = clamp01(1 - torsoInclination / this.config.maxTorsoInclinationDegrees);
    const reachedBottom = kneeAngle <= this.config.bottomKneeAngle;
    const reachedTop = kneeAngle >= this.config.topKneeAngle;
    const hasPostureWarning = torsoInclination > this.config.maxTorsoInclinationDegrees;

    this.lowestKneeAngle = Math.min(this.lowestKneeAngle, kneeAngle);
    this.metrics = {
      primaryJointAngle: kneeAngle,
      kneeAngle,
      rangeOfMotionScore: this.depthScore(),
      postureScore,
      movementConfidence: movementConfidence(
        features.movementConfidence,
        features.bodyOrientationScore,
        bodyState.orientation.confidence,
      ),
      temporalMovementConfidence: this.recognitionConfidence.snapshot().confidence,
      poseConfidence: features.poseConfidence,
      torsoInclination,
      kneeLiftRatio: features.kneeLiftRatio ?? 0,
      sampleWindowMs: windowSnapshot.durationMs,
      missingSampleRatio: windowSnapshot.missingSampleRatio,
      primaryJointVelocity: kneeVelocity?.valuePerSecond ?? 0,
    };
    const confidenceSnapshot = this.recognitionConfidence.addSample(
      this.metrics.movementConfidence ?? 0,
    );
    this.metrics.temporalMovementConfidence = confidenceSnapshot.confidence;
    this.warnings = this.buildWarnings(hasPostureWarning);

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
          this.bottomEnteredAt = features.timestampMs;
        } else if (reachedTop) {
          this.recordPartialRep(features.timestampMs, postureScore);
          this.phase = 'top';
        }
        break;

      case 'bottom':
        if (
          this.bottomEnteredAt !== undefined &&
          features.timestampMs - this.bottomEnteredAt < this.config.minBottomHoldMs
        ) {
          break;
        }

        if (!reachedBottom) {
          this.phase = 'ascending';
        }
        break;

      case 'ascending':
        if (reachedTop) {
          this.recordValidRep(features.timestampMs, postureScore);
          this.phase = 'top';
        } else if (reachedBottom) {
          this.phase = 'bottom';
          this.bottomEnteredAt = features.timestampMs;
        }
        break;
    }

    this.recognition = this.buildRecognition(
      this.phase === 'setup_needed' || confidenceSnapshot.state !== 'active'
        ? 'candidate'
        : 'active',
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
    this.lowestKneeAngle = 180;
    this.warnings = [];
    this.metrics = {};
    this.recognition = trackingLostRecognition;
    this.lastTimestampMs = undefined;
    this.movementWindow.reset();
    this.recognitionConfidence.reset();
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
    this.bottomEnteredAt = undefined;
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
    this.bottomEnteredAt = undefined;
  }

  private depthScore(): number {
    const depthRange = this.config.topKneeAngle - this.config.bottomKneeAngle;

    if (depthRange <= 0) {
      return 0;
    }

    return clamp01((this.config.topKneeAngle - this.lowestKneeAngle) / depthRange);
  }

  private nextMissingTimestamp(): number {
    this.lastTimestampMs = (this.lastTimestampMs ?? 0) + 16;
    return this.lastTimestampMs;
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

const trackingLostRecognition: MovementRecognition = {
  confidence: 0,
  status: 'tracking_lost',
  evidence: [],
};

const trackingLostWarning: FormWarning = {
  code: 'tracking_lost',
  message: 'Move fully into frame so the app can track your body.',
};
