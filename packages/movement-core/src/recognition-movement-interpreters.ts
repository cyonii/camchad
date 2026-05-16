import type {
  FormWarning,
  MovementInterpreter,
  MovementInterpreterState,
  MovementPhase,
  MovementRecognition,
  RepEvent,
} from './movement-interpreter.js';
import {
  extractPoseMovementFeatures,
  type BodyOrientation,
  type PoseMovementFeatures,
} from './pose-movement-features.js';

export type RecognitionMovementType =
  | 'sit_up'
  | 'lunge'
  | 'jumping_jack'
  | 'plank'
  | 'pull_up'
  | 'burpee'
  | 'mountain_climber'
  | 'high_knees'
  | 'lateral_raise'
  | 'yoga_hold';

type MovementDirection = 'increase' | 'decrease';

interface CycleMovementInterpreterConfig {
  readonly movementType: RecognitionMovementType;
  readonly minVisibility: number;
  readonly expectedOrientations: readonly BodyOrientation[];
  readonly restThreshold: number;
  readonly peakThreshold: number;
  readonly direction: MovementDirection;
  readonly minPeakHoldMs: number;
  readonly primaryMetricKey: string;
  readonly primaryMetric: (features: PoseMovementFeatures) => number | undefined;
  readonly recognitionScore: (features: PoseMovementFeatures, metric: number) => number;
  readonly evidence: readonly string[];
}

interface HoldMovementInterpreterConfig {
  readonly movementType: RecognitionMovementType;
  readonly minVisibility: number;
  readonly expectedOrientations: readonly BodyOrientation[];
  readonly minHoldMs: number;
  readonly primaryMetricKey: string;
  readonly primaryMetric: (features: PoseMovementFeatures) => number | undefined;
  readonly recognitionScore: (features: PoseMovementFeatures, metric: number) => number;
  readonly evidence: readonly string[];
}

export function createRecognitionMovementInterpreter(
  movementType: RecognitionMovementType,
): MovementInterpreter {
  const config = recognitionMovementConfigs[movementType];

  if (config.kind === 'hold') {
    return new HoldRecognitionMovementInterpreter(config);
  }

  return new CycleRecognitionMovementInterpreter(config);
}

class CycleRecognitionMovementInterpreter implements MovementInterpreter {
  public readonly movementType: RecognitionMovementType;

  private phase: MovementPhase = 'setup_needed';
  private reps = 0;
  private validReps = 0;
  private partialReps = 0;
  private lastRep?: RepEvent;
  private peakEnteredAt?: number;
  private extremeMetric: number;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;

  public constructor(private readonly config: CycleMovementInterpreterConfig) {
    this.movementType = config.movementType;
    this.extremeMetric = config.direction === 'increase' ? 0 : 180;
  }

  public processPose(
    frame: Parameters<MovementInterpreter['processPose']>[0],
  ): MovementInterpreterState {
    const features = extractPoseMovementFeatures(frame, this.config.minVisibility);

    if (!features) {
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const metric = this.config.primaryMetric(features);

    if (metric === undefined) {
      this.phase = 'tracking_lost';
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    if (!this.config.expectedOrientations.includes(features.bodyOrientation)) {
      this.phase = 'setup_needed';
      this.warnings = [];
      this.metrics = this.metricsFor(features, metric, 0.12);
      this.recognition = {
        movementType: this.movementType,
        confidence: 0.12,
        status: 'candidate',
        evidence: ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    const confidence = clamp01(this.config.recognitionScore(features, metric));
    const reachedRest = this.reachedRest(metric);
    const reachedPeak = this.reachedPeak(metric);

    this.extremeMetric =
      this.config.direction === 'increase'
        ? Math.max(this.extremeMetric, metric)
        : Math.min(this.extremeMetric, metric);
    this.metrics = this.metricsFor(features, metric, confidence);
    this.warnings = confidence < 0.42 ? [lowConfidenceWarning] : [];

    switch (this.phase) {
      case 'tracking_lost':
      case 'setup_needed':
      case 'invalid_form':
        this.phase = reachedRest ? 'top' : 'setup_needed';
        break;

      case 'top':
        if (reachedPeak) {
          this.phase = 'bottom';
          this.peakEnteredAt = features.timestampMs;
        } else if (!reachedRest) {
          this.phase = 'descending';
        }
        break;

      case 'descending':
        if (reachedPeak) {
          this.phase = 'bottom';
          this.peakEnteredAt = features.timestampMs;
        } else if (reachedRest) {
          this.recordPartialRep(features.timestampMs);
          this.phase = 'top';
        }
        break;

      case 'bottom':
        if (
          this.peakEnteredAt !== undefined &&
          features.timestampMs - this.peakEnteredAt < this.config.minPeakHoldMs
        ) {
          break;
        }

        if (!reachedPeak) {
          this.phase = 'ascending';
        }
        break;

      case 'ascending':
        if (reachedRest) {
          this.recordValidRep(features.timestampMs);
          this.phase = 'top';
        } else if (reachedPeak) {
          this.phase = 'bottom';
          this.peakEnteredAt = features.timestampMs;
        }
        break;
    }

    this.recognition = {
      movementType: this.movementType,
      confidence,
      status: this.phase === 'setup_needed' ? 'candidate' : 'active',
      evidence: this.config.evidence,
    };

    return this.getState();
  }

  public reset(): void {
    this.phase = 'setup_needed';
    this.reps = 0;
    this.validReps = 0;
    this.partialReps = 0;
    this.lastRep = undefined;
    this.peakEnteredAt = undefined;
    this.extremeMetric = this.config.direction === 'increase' ? 0 : 180;
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

  private reachedRest(metric: number): boolean {
    return this.config.direction === 'increase'
      ? metric <= this.config.restThreshold
      : metric >= this.config.restThreshold;
  }

  private reachedPeak(metric: number): boolean {
    return this.config.direction === 'increase'
      ? metric >= this.config.peakThreshold
      : metric <= this.config.peakThreshold;
  }

  private depthScore(): number {
    const range = Math.abs(this.config.peakThreshold - this.config.restThreshold);

    if (range <= 0) {
      return 0;
    }

    const progress =
      this.config.direction === 'increase'
        ? (this.extremeMetric - this.config.restThreshold) / range
        : (this.config.restThreshold - this.extremeMetric) / range;

    return clamp01(progress);
  }

  private metricsFor(
    features: PoseMovementFeatures,
    metric: number,
    confidence: number,
  ): Record<string, number> {
    return {
      [this.config.primaryMetricKey]: metric,
      primaryJointAngle: metric,
      rangeOfMotionScore: this.depthScore(),
      alignmentScore: confidence,
      postureScore: confidence,
      movementConfidence: confidence,
      poseConfidence: features.poseConfidence,
      bodyOrientationScore: features.bodyOrientationScore,
    };
  }

  private recordValidRep(timestampMs: number): void {
    this.reps += 1;
    this.validReps += 1;
    this.lastRep = this.repEvent(timestampMs, this.depthScore(), this.warnings);
    this.resetCycle();
  }

  private recordPartialRep(timestampMs: number): void {
    const depthScore = this.depthScore();

    if (depthScore < 0.22) {
      this.resetCycle();
      return;
    }

    this.reps += 1;
    this.partialReps += 1;
    this.lastRep = this.repEvent(timestampMs, depthScore, [
      ...this.warnings,
      {
        code: 'range_of_motion',
        message: 'Movement pattern was detected, but the range was incomplete.',
      },
    ]);
    this.resetCycle();
  }

  private repEvent(
    timestampMs: number,
    depthScore: number,
    warnings: readonly FormWarning[],
  ): RepEvent {
    const alignmentScore = this.metrics.alignmentScore ?? 0;

    return {
      repNumber: this.reps,
      timestampMs,
      qualityScore: Math.round((alignmentScore + depthScore) * 50),
      depthScore,
      alignmentScore,
      warnings,
    };
  }

  private resetCycle(): void {
    this.peakEnteredAt = undefined;
    this.extremeMetric = this.config.direction === 'increase' ? 0 : 180;
  }
}

class HoldRecognitionMovementInterpreter implements MovementInterpreter {
  public readonly movementType: RecognitionMovementType;

  private phase: MovementPhase = 'setup_needed';
  private reps = 0;
  private validReps = 0;
  private lastRep?: RepEvent;
  private holdStartedAt?: number;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;

  public constructor(private readonly config: HoldMovementInterpreterConfig) {
    this.movementType = config.movementType;
  }

  public processPose(
    frame: Parameters<MovementInterpreter['processPose']>[0],
  ): MovementInterpreterState {
    const features = extractPoseMovementFeatures(frame, this.config.minVisibility);

    if (!features) {
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const metric = this.config.primaryMetric(features);

    if (metric === undefined) {
      this.phase = 'tracking_lost';
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const orientationMatches = this.config.expectedOrientations.includes(features.bodyOrientation);
    const confidence = orientationMatches
      ? clamp01(this.config.recognitionScore(features, metric))
      : 0.12;
    const isHeld = confidence >= 0.58;

    this.metrics = {
      [this.config.primaryMetricKey]: metric,
      primaryJointAngle: metric,
      rangeOfMotionScore: confidence,
      alignmentScore: confidence,
      postureScore: confidence,
      movementConfidence: confidence,
      poseConfidence: features.poseConfidence,
      holdSeconds:
        this.holdStartedAt === undefined
          ? 0
          : Math.max(0, (features.timestampMs - this.holdStartedAt) / 1000),
    };
    this.warnings = confidence < 0.42 ? [lowConfidenceWarning] : [];

    if (!orientationMatches || !isHeld) {
      this.phase = 'setup_needed';
      this.holdStartedAt = undefined;
      this.recognition = {
        movementType: this.movementType,
        confidence,
        status: 'candidate',
        evidence: orientationMatches ? this.config.evidence : ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    this.holdStartedAt ??= features.timestampMs;
    this.phase = 'bottom';
    const hasSatisfiedHold = features.timestampMs - this.holdStartedAt >= this.config.minHoldMs;

    if (this.validReps === 0 && hasSatisfiedHold) {
      this.reps = 1;
      this.validReps = 1;
      this.lastRep = {
        repNumber: 1,
        timestampMs: features.timestampMs,
        qualityScore: Math.round(confidence * 100),
        depthScore: confidence,
        alignmentScore: confidence,
        warnings: this.warnings,
      };
    }

    this.recognition = {
      movementType: this.movementType,
      confidence,
      status: hasSatisfiedHold ? 'active' : 'candidate',
      evidence: this.config.evidence,
    };

    return this.getState();
  }

  public reset(): void {
    this.phase = 'setup_needed';
    this.reps = 0;
    this.validReps = 0;
    this.lastRep = undefined;
    this.holdStartedAt = undefined;
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
      partialReps: 0,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }
}

const recognitionMovementConfigs: Record<
  RecognitionMovementType,
  | (CycleMovementInterpreterConfig & { readonly kind: 'cycle' })
  | (HoldMovementInterpreterConfig & { readonly kind: 'hold' })
> = {
  sit_up: {
    kind: 'cycle',
    movementType: 'sit_up',
    minVisibility: 0.45,
    expectedOrientations: ['horizontal', 'diagonal'],
    restThreshold: 132,
    peakThreshold: 92,
    direction: 'decrease',
    minPeakHoldMs: 80,
    primaryMetricKey: 'hipAngle',
    primaryMetric: (features) => features.averageHipAngle,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, metric <= 132 ? 0.78 : 0.48, features.bodyOrientationScore),
    evidence: ['floor_body_orientation', 'torso_curl_signal', 'hip_flexion_range'],
  },
  lunge: {
    kind: 'cycle',
    movementType: 'lunge',
    minVisibility: 0.45,
    expectedOrientations: ['vertical', 'diagonal'],
    restThreshold: 156,
    peakThreshold: 108,
    direction: 'decrease',
    minPeakHoldMs: 80,
    primaryMetricKey: 'kneeAngle',
    primaryMetric: (features) => features.averageKneeAngle,
    recognitionScore: (features, metric) =>
      confidenceBlend(
        features,
        metric <= 150 ? 0.72 : 0.42,
        spanScore(features.ankleSpanRatio, 0.52),
      ),
    evidence: ['split_stance_signal', 'single_leg_knee_flexion', 'hip_drop_range'],
  },
  jumping_jack: {
    kind: 'cycle',
    movementType: 'jumping_jack',
    minVisibility: 0.45,
    expectedOrientations: ['vertical'],
    restThreshold: 1.05,
    peakThreshold: 2.1,
    direction: 'increase',
    minPeakHoldMs: 40,
    primaryMetricKey: 'limbSpanRatio',
    primaryMetric: (features) =>
      features.wristSpanRatio === undefined || features.ankleSpanRatio === undefined
        ? undefined
        : features.wristSpanRatio + features.ankleSpanRatio,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, metric >= 1.35 ? 0.76 : 0.46, features.bodyOrientationScore),
    evidence: ['standing_body_orientation', 'arm_leg_abduction', 'span_oscillation'],
  },
  plank: {
    kind: 'hold',
    movementType: 'plank',
    minVisibility: 0.45,
    expectedOrientations: ['horizontal'],
    minHoldMs: 1200,
    primaryMetricKey: 'bodyLineDeviation',
    primaryMetric: (features) => features.bodyLineDeviation,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, clamp01(1 - metric / 0.22), features.bodyOrientationScore),
    evidence: ['horizontal_body_orientation', 'body_line_stability', 'static_hold_signal'],
  },
  pull_up: {
    kind: 'cycle',
    movementType: 'pull_up',
    minVisibility: 0.45,
    expectedOrientations: ['vertical'],
    restThreshold: 152,
    peakThreshold: 92,
    direction: 'decrease',
    minPeakHoldMs: 80,
    primaryMetricKey: 'elbowAngle',
    primaryMetric: (features) => features.averageElbowAngle,
    recognitionScore: (features, metric) =>
      confidenceBlend(
        features,
        metric <= 150 ? 0.72 : 0.42,
        elevationScore(features.wristElevationRatio, 0.24),
      ),
    evidence: ['vertical_hanging_posture', 'wrist_over_shoulder_position', 'elbow_flexion_range'],
  },
  burpee: {
    kind: 'cycle',
    movementType: 'burpee',
    minVisibility: 0.45,
    expectedOrientations: ['vertical', 'diagonal', 'horizontal'],
    restThreshold: 0.34,
    peakThreshold: 0.76,
    direction: 'increase',
    minPeakHoldMs: 80,
    primaryMetricKey: 'orientationTransitionScore',
    primaryMetric: (features) =>
      features.bodyOrientation === 'horizontal'
        ? 1
        : features.bodyOrientation === 'diagonal'
          ? 0.62
          : 0.12,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, metric >= 0.62 ? 0.74 : 0.42, features.bodyOrientationScore),
    evidence: ['standing_floor_transition', 'compound_body_orientation_change', 'whole_body_cycle'],
  },
  mountain_climber: {
    kind: 'cycle',
    movementType: 'mountain_climber',
    minVisibility: 0.45,
    expectedOrientations: ['horizontal', 'diagonal'],
    restThreshold: 0.08,
    peakThreshold: 0.34,
    direction: 'increase',
    minPeakHoldMs: 40,
    primaryMetricKey: 'kneeLiftRatio',
    primaryMetric: (features) => features.maxKneeLiftRatio ?? features.kneeLiftRatio,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, metric >= 0.16 ? 0.72 : 0.4, features.bodyOrientationScore),
    evidence: ['plank_base_orientation', 'alternating_knee_drive', 'knee_lift_rhythm'],
  },
  high_knees: {
    kind: 'cycle',
    movementType: 'high_knees',
    minVisibility: 0.45,
    expectedOrientations: ['vertical', 'diagonal'],
    restThreshold: 0.05,
    peakThreshold: 0.36,
    direction: 'increase',
    minPeakHoldMs: 40,
    primaryMetricKey: 'kneeLiftRatio',
    primaryMetric: (features) => features.maxKneeLiftRatio ?? features.kneeLiftRatio,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, metric >= 0.18 ? 0.76 : 0.42, features.bodyOrientationScore),
    evidence: ['standing_body_orientation', 'knee_lift_height', 'alternating_cadence'],
  },
  lateral_raise: {
    kind: 'cycle',
    movementType: 'lateral_raise',
    minVisibility: 0.45,
    expectedOrientations: ['vertical'],
    restThreshold: 0.9,
    peakThreshold: 1.72,
    direction: 'increase',
    minPeakHoldMs: 80,
    primaryMetricKey: 'wristSpanRatio',
    primaryMetric: (features) => features.wristSpanRatio,
    recognitionScore: (features, metric) =>
      confidenceBlend(
        features,
        metric >= 1.15 ? 0.7 : 0.42,
        shoulderHeightScore(features.wristElevationRatio),
      ),
    evidence: ['standing_body_orientation', 'arm_abduction_range', 'wrist_span_change'],
  },
  yoga_hold: {
    kind: 'hold',
    movementType: 'yoga_hold',
    minVisibility: 0.45,
    expectedOrientations: ['vertical', 'diagonal', 'horizontal'],
    minHoldMs: 1500,
    primaryMetricKey: 'poseStabilityScore',
    primaryMetric: (features) => features.movementConfidence,
    recognitionScore: (features, metric) =>
      confidenceBlend(features, metric, features.bodyOrientationScore),
    evidence: ['static_pose_geometry', 'body_orientation_stability', 'hold_consistency'],
  },
};

function confidenceBlend(
  features: PoseMovementFeatures,
  patternScore: number,
  secondaryScore: number | undefined,
): number {
  return clamp01(
    features.poseConfidence * 0.34 +
      features.bodyOrientationScore * 0.24 +
      patternScore * 0.3 +
      (secondaryScore ?? 0) * 0.12,
  );
}

function spanScore(value: number | undefined, target: number): number {
  return value === undefined ? 0 : clamp01(value / target);
}

function elevationScore(value: number | undefined, target: number): number {
  return value === undefined ? 0 : clamp01(value / target);
}

function shoulderHeightScore(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  return clamp01(1 - Math.abs(value) / 0.55);
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

const lowConfidenceWarning: FormWarning = {
  code: 'low_confidence',
  message: 'Tracking confidence is low. Improve lighting or adjust camera placement.',
};
