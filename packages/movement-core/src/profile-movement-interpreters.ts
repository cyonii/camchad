import type {
  FormWarning,
  MovementInterpreter,
  MovementInterpreterState,
  MovementPhase,
  MovementRecognition,
  MovementType,
  RepEvent,
} from './movement-interpreter.js';
import type { MovementFamilyPrimitive } from './movement-definition-types.js';
import { HoldStateMachine, type HoldStateMachineState } from './hold-state-machine.js';
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
import { buildRepQualityComponents, trackingQualityFromMetrics } from './rep-quality.js';

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
type MovementSide = 'left' | 'right';

interface CycleMovementInterpreterConfig {
  readonly movementType: ProfileMovementType;
  readonly family: MovementFamilyPrimitive;
  readonly minVisibility: number;
  readonly expectedOrientations: readonly BodyOrientationSignal[];
  readonly restThreshold: number;
  readonly peakThreshold: number;
  readonly direction: MovementDirection;
  readonly minPeakHoldMs: number;
  readonly primaryMetricKey: string;
  readonly primaryMetric: (context: MovementProfileEvaluationContext) => number | undefined;
  readonly activeSide?: (context: MovementProfileEvaluationContext) => MovementSide | undefined;
  readonly requiresAlternation?: boolean;
  readonly recognitionScore: (context: MovementProfileEvaluationContext, metric: number) => number;
  readonly evidence: readonly string[];
}

interface HoldMovementInterpreterConfig {
  readonly movementType: ProfileMovementType;
  readonly family: MovementFamilyPrimitive;
  readonly minVisibility: number;
  readonly expectedOrientations: readonly BodyOrientationSignal[];
  readonly minHoldMs: number;
  readonly primaryMetricKey: string;
  readonly primaryMetric: (context: MovementProfileEvaluationContext) => number | undefined;
  readonly recognitionScore: (context: MovementProfileEvaluationContext, metric: number) => number;
  readonly evidence: readonly string[];
  readonly pendingHoldConfidenceScale?: number;
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

export function movementFamilyForProfile(
  movementType: ProfileMovementType,
): MovementFamilyPrimitive {
  return profileMovementConfigs[movementType].family;
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
  private currentPeakSide?: MovementSide;
  private lastCompletedPeakSide?: MovementSide;
  private missedAlternationCount = 0;
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
    const activeSide = this.config.activeSide?.(context);

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

    if (reachedPeak && activeSide) {
      this.currentPeakSide = activeSide;
    }

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
          const completedPeakSide = this.currentPeakSide;

          if (this.hasMissedAlternation()) {
            this.recordPartialRep(timestampMs, [missedAlternationWarning]);
            this.missedAlternationCount += 1;
          } else {
            this.recordValidRep(timestampMs);
          }
          if (completedPeakSide) {
            this.lastCompletedPeakSide = completedPeakSide;
          }
          this.phase = 'top';
        } else if (reachedPeak) {
          this.phase = 'bottom';
          this.peakEnteredAt = timestampMs;
        }
        break;
    }

    this.metrics = {
      ...this.metrics,
      alternationScore: this.alternationScore(),
      missedAlternationCount: this.missedAlternationCount,
    };

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
    this.currentPeakSide = undefined;
    this.lastCompletedPeakSide = undefined;
    this.missedAlternationCount = 0;
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

  private rangeScore(): number {
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
      rangeOfMotionScore: this.rangeScore(),
      alignmentScore: confidence,
      postureScore: confidence,
      movementConfidence: confidence,
      poseConfidence: bodyState.confidence,
      bodyOrientationScore: bodyOrientationScore(context),
      temporalConfidence: window.averageConfidence,
      missingSampleRatio: window.missingSampleRatio,
      alternationScore: this.alternationScore(),
      missedAlternationCount: this.missedAlternationCount,
    };
  }

  private hasMissedAlternation(): boolean {
    return (
      this.config.requiresAlternation === true &&
      this.currentPeakSide !== undefined &&
      this.lastCompletedPeakSide === this.currentPeakSide
    );
  }

  private alternationScore(): number {
    if (!this.config.requiresAlternation || this.lastCompletedPeakSide === undefined) {
      return 1;
    }

    return this.hasMissedAlternation() ? 0 : 1;
  }

  private recordValidRep(timestampMs: number): void {
    this.reps += 1;
    this.validReps += 1;
    this.lastRep = this.repEvent(timestampMs, this.rangeScore(), this.warnings);
    this.resetCycle();
  }

  private recordPartialRep(timestampMs: number, warnings: readonly FormWarning[] = []): void {
    const rangeScore = this.rangeScore();

    if (rangeScore < 0.22) {
      this.resetCycle();
      return;
    }

    this.reps += 1;
    this.partialReps += 1;
    this.lastRep = this.repEvent(timestampMs, rangeScore, [
      ...this.warnings,
      ...warnings,
      {
        code: 'range_of_motion',
        message: 'Movement pattern was detected, but the range was incomplete.',
      },
    ]);
    this.resetCycle();
  }

  private repEvent(
    timestampMs: number,
    rangeScore: number,
    warnings: readonly FormWarning[],
  ): RepEvent {
    const alignmentScore = this.metrics.alignmentScore ?? 0;
    const rhythmScore = this.metrics.rhythmScore ?? 0;
    const confidenceScore =
      this.metrics.temporalMovementConfidence ?? this.metrics.movementConfidence ?? 0;
    const trackingQualityScore = trackingQualityFromMetrics(this.metrics);

    return {
      repNumber: this.reps,
      timestampMs,
      ...buildRepQualityComponents({
        rangeScore,
        alignmentScore,
        rhythmScore,
        confidenceScore,
        trackingQualityScore,
      }),
      warnings,
    };
  }

  private resetCycle(): void {
    this.peakEnteredAt = undefined;
    this.extremeMetric = this.config.direction === 'increase' ? 0 : 180;
    this.currentPeakSide = undefined;
  }
}

class HoldProfileMovementInterpreter implements MovementInterpreter {
  public readonly movementType: ProfileMovementType;

  private reps = 0;
  private validReps = 0;
  private lastRep?: RepEvent;
  private warnings: FormWarning[] = [];
  private metrics: Record<string, number> = {};
  private recognition: MovementRecognition = trackingLostRecognition;
  private readonly window = createMovementProfileWindow();
  private readonly holdMachine: HoldStateMachine;

  public constructor(private readonly config: HoldMovementInterpreterConfig) {
    this.movementType = config.movementType;
    this.holdMachine = new HoldStateMachine({
      minHoldMs: config.minHoldMs,
      enterConfidence: 0.58,
      exitConfidence: 0.42,
    });
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
      this.holdMachine.reset();
      this.warnings = [trackingLostWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const { bodyState, window } = context;
    const timestampMs = bodyState.timestampMs;
    const orientation = bodyOrientationSignal(bodyState.orientation.kind);
    const metric = this.config.primaryMetric(context);

    if (metric === undefined) {
      this.holdMachine.reset();
      this.warnings = [lowConfidenceWarning];
      this.recognition = trackingLostRecognition;
      return this.getState();
    }

    const orientationMatches = this.config.expectedOrientations.includes(orientation);
    const confidence = orientationMatches
      ? clamp01(this.config.recognitionScore(context, metric))
      : 0.12;
    const holdState = this.holdMachine.update({
      timestampMs,
      holdConfidence: orientationMatches ? confidence : 0,
    });

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
      holdSeconds: Math.max(0, holdState.holdDurationMs / 1000),
    };
    this.warnings = confidence < 0.42 ? [lowConfidenceWarning] : [];

    if (!orientationMatches || holdState.phase === 'setup_needed' || holdState.phase === 'broken') {
      this.recognition = {
        movementType: this.movementType,
        confidence,
        status: 'candidate',
        evidence: orientationMatches ? this.config.evidence : ['body_orientation_mismatch'],
      };
      return this.getState();
    }

    if (holdState.completedHoldCount > this.validReps) {
      this.reps = holdState.completedHoldCount;
      this.validReps = holdState.completedHoldCount;
      const trackingQualityScore = trackingQualityFromMetrics(this.metrics);
      this.lastRep = {
        repNumber: this.validReps,
        timestampMs,
        ...buildRepQualityComponents({
          rangeScore: confidence,
          alignmentScore: confidence,
          rhythmScore: 1,
          confidenceScore: confidence,
          trackingQualityScore,
        }),
        warnings: this.warnings,
      };
    }

    this.recognition = {
      movementType: this.movementType,
      confidence:
        holdState.phase === 'completed'
          ? confidence
          : confidence * (this.config.pendingHoldConfidenceScale ?? 1),
      status: holdState.phase === 'completed' ? 'active' : 'candidate',
      evidence: this.config.evidence,
    };

    return this.getState();
  }

  public reset(): void {
    this.reps = 0;
    this.validReps = 0;
    this.lastRep = undefined;
    this.warnings = [];
    this.metrics = {};
    this.recognition = trackingLostRecognition;
    this.holdMachine.reset();
    this.window.reset();
  }

  public getState(): MovementInterpreterState {
    return {
      movementType: this.movementType,
      recognition: this.recognition,
      phase: phaseForHoldState(this.holdMachine.getState(), this.recognition.status),
      reps: this.reps,
      validReps: this.validReps,
      partialReps: 0,
      lastRep: this.lastRep,
      warnings: this.warnings,
      metrics: this.metrics,
    };
  }
}

function phaseForHoldState(
  holdState: HoldStateMachineState,
  recognitionStatus: MovementRecognition['status'],
): MovementPhase {
  if (recognitionStatus === 'tracking_lost') {
    return 'tracking_lost';
  }

  if (holdState.phase === 'holding' || holdState.phase === 'completed') {
    return 'bottom';
  }

  return 'setup_needed';
}

const profileMovementConfigs: Record<
  ProfileMovementType,
  | (CycleMovementInterpreterConfig & { readonly kind: 'cycle' })
  | (HoldMovementInterpreterConfig & { readonly kind: 'hold' })
> = {
  sit_up: {
    kind: 'cycle',
    movementType: 'sit_up',
    family: 'cyclic_joint_flexion',
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
    family: 'asymmetrical_stance',
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
        (maxKneeLiftRatio(context) ?? 0) > 0.18 ? 0.16 : metric <= 150 ? 0.72 : 0.42,
        spanScore(ankleSpanRatio(context), 0.52),
      ),
    evidence: ['split_stance_signal', 'single_leg_knee_flexion', 'hip_drop_range'],
  },
  jumping_jack: {
    kind: 'cycle',
    movementType: 'jumping_jack',
    family: 'span_oscillation',
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
    recognitionScore: (context) =>
      confidenceBlend(
        context,
        Math.min(spanScore(wristSpanRatio(context), 0.95), spanScore(ankleSpanRatio(context), 0.7)),
        bodyOrientationScore(context),
      ),
    evidence: ['standing_body_orientation', 'arm_leg_abduction', 'span_oscillation'],
  },
  plank: {
    kind: 'hold',
    movementType: 'plank',
    family: 'static_hold',
    minVisibility: 0.45,
    expectedOrientations: ['horizontal'],
    minHoldMs: 1200,
    primaryMetricKey: 'bodyLineDeviation',
    primaryMetric: bodyLineDeviation,
    recognitionScore: (context, metric) =>
      confidenceBlend(
        context,
        Math.min(clamp01(1 - metric / 0.22), staticPoseStabilityScore(context)),
        bodyOrientationScore(context),
      ),
    evidence: ['horizontal_body_orientation', 'body_line_stability', 'static_hold_signal'],
  },
  pull_up: {
    kind: 'cycle',
    movementType: 'pull_up',
    family: 'cyclic_joint_flexion',
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
    family: 'compound_transition',
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
    family: 'alternating_limb_drive',
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
    family: 'alternating_limb_drive',
    minVisibility: 0.45,
    expectedOrientations: ['vertical', 'diagonal'],
    restThreshold: 0.05,
    peakThreshold: 0.36,
    direction: 'increase',
    minPeakHoldMs: 40,
    primaryMetricKey: 'kneeLiftRatio',
    primaryMetric: (context) => maxKneeLiftRatio(context) ?? kneeLiftRatio(context),
    activeSide: kneeLiftSide,
    requiresAlternation: true,
    recognitionScore: (context, metric) =>
      confidenceBlend(context, metric >= 0.18 ? 0.76 : 0.42, bodyOrientationScore(context)),
    evidence: ['standing_body_orientation', 'knee_lift_height', 'alternating_cadence'],
  },
  lateral_raise: {
    kind: 'cycle',
    movementType: 'lateral_raise',
    family: 'span_oscillation',
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
    family: 'static_hold',
    minVisibility: 0.45,
    expectedOrientations: ['vertical', 'diagonal', 'horizontal'],
    minHoldMs: 1500,
    primaryMetricKey: 'poseStabilityScore',
    primaryMetric: staticPoseStabilityScore,
    recognitionScore: (context, metric) =>
      confidenceBlend(
        context,
        metric >= 0.72 ? metric : metric * 0.45,
        bodyOrientationScore(context),
      ),
    evidence: ['static_pose_geometry', 'body_orientation_stability', 'hold_consistency'],
    pendingHoldConfidenceScale: 0.35,
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

function kneeLiftSide(context: MovementProfileEvaluationContext): MovementSide | undefined {
  const leftHip = context.bodyState.landmarks.get('left_hip');
  const leftKnee = context.bodyState.landmarks.get('left_knee');
  const rightHip = context.bodyState.landmarks.get('right_hip');
  const rightKnee = context.bodyState.landmarks.get('right_knee');

  if (!leftHip || !leftKnee || !rightHip || !rightKnee) {
    return undefined;
  }

  const leftLift = leftHip.normalizedY - leftKnee.normalizedY;
  const rightLift = rightHip.normalizedY - rightKnee.normalizedY;

  if (Math.abs(leftLift - rightLift) < 0.06) {
    return undefined;
  }

  return leftLift > rightLift ? 'left' : 'right';
}

function staticPoseStabilityScore(context: MovementProfileEvaluationContext): number {
  const jointRanges = [
    signalRange(context, (bodyState) =>
      averageDefined(bodyState.jointAngles.leftElbow, bodyState.jointAngles.rightElbow),
    ),
    signalRange(context, (bodyState) =>
      averageDefined(bodyState.jointAngles.leftKnee, bodyState.jointAngles.rightKnee),
    ),
    signalRange(context, (bodyState) =>
      averageDefined(bodyState.jointAngles.leftHip, bodyState.jointAngles.rightHip),
    ),
  ].filter((range) => range.sampleCount >= 3);
  const averageJointMotion =
    jointRanges.length === 0
      ? 0
      : jointRanges.reduce((sum, range) => sum + range.range, 0) / jointRanges.length;
  const jointStillness = clamp01(1 - averageJointMotion / 28);

  return clamp01(
    context.window.environment.centerStability * 0.34 +
      context.window.environment.scaleStability * 0.2 +
      jointStillness * 0.28 +
      movementConfidence(context) * 0.18,
  );
}

function signalRange(
  context: MovementProfileEvaluationContext,
  selector: (bodyState: MovementProfileEvaluationContext['bodyState']) => number | undefined,
): { readonly range: number; readonly sampleCount: number } {
  const values = context.window.validSamples
    .map((sample) => selector(sample.bodyState))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));

  if (values.length === 0) {
    return {
      range: 0,
      sampleCount: 0,
    };
  }

  return {
    range: Math.max(...values) - Math.min(...values),
    sampleCount: values.length,
  };
}

function averageDefined(a: number | undefined, b: number | undefined): number | undefined {
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

const lowConfidenceWarning: FormWarning = {
  code: 'low_confidence',
  message: 'Tracking confidence is low. Improve lighting or adjust camera placement.',
};

const missedAlternationWarning: FormWarning = {
  code: 'missed_alternation',
  message: 'Alternate sides cleanly so the movement rhythm stays valid.',
};
