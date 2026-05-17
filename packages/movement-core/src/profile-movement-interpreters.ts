import type {
  FormWarning,
  MovementInterpreter,
  MovementInterpreterState,
  MovementPhase,
  MovementRecognition,
  MovementType,
  RepEvent,
} from './movement-interpreter.js';
import {
  createMovementProfileWindow,
  evaluateMovementProfileFrame,
  type MovementProfileEvaluationContext,
} from './movement-profile-evaluation-context.js';
import {
  ankleSpanRatio,
  averageElbowAngle,
  averageHipAngle,
  averageKneeAngle,
  bodyLineDeviation,
  bodyOrientationScore,
  bodyOrientationSignal,
  type BodyOrientationSignal,
  kneeLiftRatio,
  maxKneeLiftRatio,
  movementConfidence,
  wristElevationRatio,
  wristSpanRatio,
} from './movement-profile-signals.js';

export type ProfileMovementType =
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
  readonly movementType: ProfileMovementType;
  readonly minVisibility: number;
  readonly expectedOrientations: readonly BodyOrientationSignal[];
  readonly restThreshold: number;
  readonly peakThreshold: number;
  readonly direction: MovementDirection;
  readonly minPeakHoldMs: number;
  readonly primaryMetricKey: string;
  readonly primaryMetric: (context: MovementProfileEvaluationContext) => number | undefined;
  readonly recognitionScore: (context: MovementProfileEvaluationContext, metric: number) => number;
  readonly evidence: readonly string[];
}

interface HoldMovementInterpreterConfig {
  readonly movementType: ProfileMovementType;
  readonly minVisibility: number;
  readonly expectedOrientations: readonly BodyOrientationSignal[];
  readonly minHoldMs: number;
  readonly primaryMetricKey: string;
  readonly primaryMetric: (context: MovementProfileEvaluationContext) => number | undefined;
  readonly recognitionScore: (context: MovementProfileEvaluationContext, metric: number) => number;
  readonly evidence: readonly string[];
}

export function createProfileMovementInterpreter(
  movementType: ProfileMovementType,
): MovementInterpreter {
  const config = profileMovementConfigs[movementType];

  if (config.kind === 'hold') {
    return new HoldProfileMovementInterpreter(config);
  }

  return new CycleProfileMovementInterpreter(config);
}

export function isProfileMovementType(
  movementType: MovementType,
): movementType is ProfileMovementType {
  return movementType in profileMovementConfigs;
}

class CycleProfileMovementInterpreter implements MovementInterpreter {
  public readonly movementType: ProfileMovementType;

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
  private readonly window = createMovementProfileWindow();

  public constructor(private readonly config: CycleMovementInterpreterConfig) {
    this.movementType = config.movementType;
    this.extremeMetric = config.direction === 'increase' ? 0 : 180;
  }

  public processPose(
    frame: Parameters<MovementInterpreter['processPose']>[0],
  ): MovementInterpreterState {
    const context = evaluateMovementProfileFrame({
      frame,
      window: this.window,
      minVisibility: this.config.minVisibility,
      interpreterState: this.getState(),
    });

    if (!context) {
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const timestampMs = context.bodyState.timestampMs;
    const orientation = bodyOrientationSignal(context.bodyState.orientation.kind);
    const metric = this.config.primaryMetric(context);

    if (metric === undefined) {
      this.phase = 'tracking_lost';
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    if (!this.config.expectedOrientations.includes(orientation)) {
      this.phase = 'setup_needed';
      this.warnings = [];
      this.metrics = this.metricsFor(context, metric, 0.12);
      this.recognition = {
        movementType: this.movementType,
        confidence: 0.12,
        status: 'candidate',
        evidence: ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    const confidence = clamp01(this.config.recognitionScore(context, metric));
    const reachedRest = this.reachedRest(metric);
    const reachedPeak = this.reachedPeak(metric);

    this.extremeMetric =
      this.config.direction === 'increase'
        ? Math.max(this.extremeMetric, metric)
        : Math.min(this.extremeMetric, metric);
    this.metrics = this.metricsFor(context, metric, confidence);
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
          this.peakEnteredAt = timestampMs;
        } else if (!reachedRest) {
          this.phase = 'descending';
        }
        break;

      case 'descending':
        if (reachedPeak) {
          this.phase = 'bottom';
          this.peakEnteredAt = timestampMs;
        } else if (reachedRest) {
          this.recordPartialRep(timestampMs);
          this.phase = 'top';
        }
        break;

      case 'bottom':
        if (
          this.peakEnteredAt !== undefined &&
          timestampMs - this.peakEnteredAt < this.config.minPeakHoldMs
        ) {
          break;
        }

        if (!reachedPeak) {
          this.phase = 'ascending';
        }
        break;

      case 'ascending':
        if (reachedRest) {
          this.recordValidRep(timestampMs);
          this.phase = 'top';
        } else if (reachedPeak) {
          this.phase = 'bottom';
          this.peakEnteredAt = timestampMs;
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
    this.window.reset();
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
    context: MovementProfileEvaluationContext,
    metric: number,
    confidence: number,
  ): Record<string, number> {
    const { bodyState, window } = context;

    return {
      [this.config.primaryMetricKey]: metric,
      primaryJointAngle: metric,
      rangeOfMotionScore: this.depthScore(),
      alignmentScore: confidence,
      postureScore: confidence,
      movementConfidence: confidence,
      poseConfidence: bodyState.confidence,
      bodyOrientationScore: bodyOrientationScore(context),
      temporalConfidence: window.averageConfidence,
      missingSampleRatio: window.missingSampleRatio,
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

class HoldProfileMovementInterpreter implements MovementInterpreter {
  public readonly movementType: ProfileMovementType;

  private phase: MovementPhase = 'setup_needed';
  private reps = 0;
  private validReps = 0;
  private lastRep?: RepEvent;
  private holdStartedAt?: number;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;
  private readonly window = createMovementProfileWindow();

  public constructor(private readonly config: HoldMovementInterpreterConfig) {
    this.movementType = config.movementType;
  }

  public processPose(
    frame: Parameters<MovementInterpreter['processPose']>[0],
  ): MovementInterpreterState {
    const context = evaluateMovementProfileFrame({
      frame,
      window: this.window,
      minVisibility: this.config.minVisibility,
      interpreterState: this.getState(),
    });

    if (!context) {
      this.phase = 'tracking_lost';
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const { bodyState, window } = context;
    const timestampMs = bodyState.timestampMs;
    const orientation = bodyOrientationSignal(bodyState.orientation.kind);
    const metric = this.config.primaryMetric(context);

    if (metric === undefined) {
      this.phase = 'tracking_lost';
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const orientationMatches = this.config.expectedOrientations.includes(orientation);
    const confidence = orientationMatches
      ? clamp01(this.config.recognitionScore(context, metric))
      : 0.12;
    const isHeld = confidence >= 0.58;

    this.metrics = {
      [this.config.primaryMetricKey]: metric,
      primaryJointAngle: metric,
      rangeOfMotionScore: confidence,
      alignmentScore: confidence,
      postureScore: confidence,
      movementConfidence: confidence,
      poseConfidence: bodyState.confidence,
      temporalConfidence: window.averageConfidence,
      missingSampleRatio: window.missingSampleRatio,
      holdSeconds:
        this.holdStartedAt === undefined
          ? 0
          : Math.max(0, (timestampMs - this.holdStartedAt) / 1000),
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

    this.holdStartedAt ??= timestampMs;
    this.phase = 'bottom';
    const hasSatisfiedHold = timestampMs - this.holdStartedAt >= this.config.minHoldMs;

    if (this.validReps === 0 && hasSatisfiedHold) {
      this.reps = 1;
      this.validReps = 1;
      this.lastRep = {
        repNumber: 1,
        timestampMs,
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
    this.window.reset();
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

const profileMovementConfigs: Record<
  ProfileMovementType,
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
    primaryMetric: averageHipAngle,
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric <= 132 ? 0.78 : 0.48, bodyOrientationScore(context)),
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
    primaryMetric: averageKneeAngle,
    recognitionScore: (context, metric) =>
      confidenceBlend(
        context,
        metric <= 150 ? 0.72 : 0.42,
        spanScore(ankleSpanRatio(context), 0.52),
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
    primaryMetric: (context) => {
      const wristSpan = wristSpanRatio(context);
      const ankleSpan = ankleSpanRatio(context);

      return wristSpan === undefined || ankleSpan === undefined ? undefined : wristSpan + ankleSpan;
    },
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric >= 1.35 ? 0.76 : 0.46, bodyOrientationScore(context)),
    evidence: ['standing_body_orientation', 'arm_leg_abduction', 'span_oscillation'],
  },
  plank: {
    kind: 'hold',
    movementType: 'plank',
    minVisibility: 0.45,
    expectedOrientations: ['horizontal'],
    minHoldMs: 1200,
    primaryMetricKey: 'bodyLineDeviation',
    primaryMetric: bodyLineDeviation,
    recognitionScore: (context, metric) =>
      confidenceBlend(context, clamp01(1 - metric / 0.22), bodyOrientationScore(context)),
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
    primaryMetric: averageElbowAngle,
    recognitionScore: (context, metric) =>
      confidenceBlend(
        context,
        metric <= 150 ? 0.72 : 0.42,
        elevationScore(wristElevationRatio(context), 0.24),
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
    primaryMetric: (context) =>
      bodyOrientationSignal(context.bodyState.orientation.kind) === 'horizontal'
        ? 1
        : bodyOrientationSignal(context.bodyState.orientation.kind) === 'diagonal'
          ? 0.62
          : 0.12,
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric >= 0.62 ? 0.74 : 0.42, bodyOrientationScore(context)),
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
    primaryMetric: (context) => maxKneeLiftRatio(context) ?? kneeLiftRatio(context),
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric >= 0.16 ? 0.72 : 0.4, bodyOrientationScore(context)),
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
    primaryMetric: (context) => maxKneeLiftRatio(context) ?? kneeLiftRatio(context),
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric >= 0.18 ? 0.76 : 0.42, bodyOrientationScore(context)),
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
    primaryMetric: wristSpanRatio,
    recognitionScore: (context, metric) =>
      confidenceBlend(
        context,
        metric >= 1.15 ? 0.7 : 0.42,
        shoulderHeightScore(wristElevationRatio(context)),
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
    primaryMetric: movementConfidence,
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric, bodyOrientationScore(context)),
    evidence: ['static_pose_geometry', 'body_orientation_stability', 'hold_consistency'],
  },
};

function confidenceBlend(
  context: MovementProfileEvaluationContext,
  patternScore: number,
  secondaryScore: number | undefined,
): number {
  return clamp01(
    context.bodyState.confidence * 0.34 +
      bodyOrientationScore(context) * 0.24 +
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
