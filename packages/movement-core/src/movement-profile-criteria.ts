import type { BodyState } from './body-state.js';
import type { CameraAngle } from './movement-interpreter.js';
import type {
  MovementDefinition,
  MovementProfileCriterion,
  MovementRegion,
} from './movement-registry.js';
import type { MovementProfileEvaluationContext } from './movement-profile-evaluation-context.js';
import {
  ankleSpanRatio,
  bodyLineDeviation,
  bodyOrientationSignal,
  maxKneeLiftRatio,
  wristSpanRatio,
} from './movement-profile-signals.js';

export interface MovementCriterionEvaluation {
  readonly key: string;
  readonly label: string;
  readonly passed: boolean;
  readonly score: number;
  readonly evidence: string;
}

export interface MovementProfileCriteriaEvaluation {
  readonly confidence: number;
  readonly passed: boolean;
  readonly evaluations: readonly MovementCriterionEvaluation[];
  readonly evidence: readonly string[];
}

type CriterionEvaluator = (context: MovementProfileEvaluationContext) => number;

const criterionEvaluators = {
  alternating_knee_drive: scoreHighKneeLift,
  alternating_knee_lift: scoreHighKneeLift,
  arm_elevation_symmetry: scoreWristSpan,
  arm_leg_abduction_rhythm: scoreAppendageSpanOscillation,
  body_line_quality: scoreHorizontalBodyLine,
  body_line_signal: scoreHorizontalBodyLine,
  compound_motion_rhythm: scoreCompoundMotionRhythm,
  elbow_flexion: scoreElbowSignal,
  elbow_flexion_signal: scoreElbowFlexionSignal,
  floor_orientation: scoreBodyOrientation,
  front_knee_flexion: scoreKneeSignal,
  hip_anchor_stability: scoreHipSignal,
  hip_drop: scoreHipSignal,
  hip_level_change: scoreHipSignal,
  hold_stability: scoreStaticHoldStability,
  horizontal_body_line: scoreHorizontalBodyLine,
  knee_flexion_signal: scoreKneeSignal,
  plank_base: scoreHorizontalBodyLine,
  push_up_depth: scoreElbowSignal,
  shoulder_abduction: scoreWristSpan,
  shoulder_elevation_change: scoreElbowSignal,
  split_stance: scoreSplitStance,
  squat_depth: scoreKneeSignal,
  standing_floor_standing_transition: scoreStandingFloorTransition,
  standing_orientation: scoreBodyOrientation,
  static_hold_stability: scoreStaticHoldStability,
  static_pose_geometry: scoreStaticHoldStability,
  torso_control: scoreTorsoControl,
  torso_curl_trajectory: scoreHipSignal,
  vertical_cadence: scoreVerticalCadence,
  vertical_hanging_posture: scoreBodyOrientation,
  wrist_and_ankle_span_oscillation: scoreAppendageSpanOscillation,
} satisfies Record<string, CriterionEvaluator>;

export function evaluateMovementRecognitionCriteria(input: {
  readonly definition: MovementDefinition;
  readonly context: MovementProfileEvaluationContext;
  readonly cameraAngle?: CameraAngle;
  readonly minRegionCoverage?: number;
}): MovementProfileCriteriaEvaluation {
  const minRegionCoverage = input.minRegionCoverage ?? 0.45;
  const criteria = input.definition.profile.recognitionCriteria.filter(
    (criterion) => criterion.source === 'declarative',
  );
  const evaluations = [
    ...input.definition.profile.requiredRegions.map((region) =>
      evaluateRequiredRegion(input.context.bodyState, region, minRegionCoverage),
    ),
    evaluateBodyOrientation(input.definition, input.context.bodyState),
    ...(input.cameraAngle ? [evaluateCameraAngle(input.definition, input.cameraAngle)] : []),
    ...criteria.map((criterion) => evaluateCriterion(criterion, input.context)),
  ];
  const confidence = average(evaluations.map((evaluation) => evaluation.score));

  return {
    confidence,
    passed: confidence >= 0.58 && evaluations.every((evaluation) => evaluation.passed),
    evaluations,
    evidence: evaluations
      .filter((evaluation) => evaluation.passed)
      .map((evaluation) => evaluation.evidence),
  };
}

function evaluateRequiredRegion(
  bodyState: BodyState,
  region: MovementRegion,
  minRegionCoverage: number,
): MovementCriterionEvaluation {
  const score = regionCoverage(bodyState, region);

  return {
    key: `region_${region}`,
    label: `${region} visibility`,
    passed: score >= minRegionCoverage,
    score,
    evidence: `${region}_visible`,
  };
}

function evaluateBodyOrientation(
  definition: MovementDefinition,
  bodyState: BodyState,
): MovementCriterionEvaluation {
  const expected = definition.bodyOrientation;
  const actual = bodyState.orientation.kind;
  const passed =
    expected === 'mixed' ||
    (expected === 'floor' && actual === 'floor') ||
    (expected === 'standing' && (actual === 'standing' || actual === 'diagonal')) ||
    (expected === 'seated' && actual === 'seated') ||
    (expected === 'hanging' && actual === 'hanging');
  const score = passed ? bodyState.orientation.confidence : bodyState.orientation.confidence * 0.2;

  return {
    key: 'body_orientation',
    label: 'Body orientation',
    passed,
    score,
    evidence: passed ? `${expected}_orientation_match` : 'body_orientation_mismatch',
  };
}

function evaluateCameraAngle(
  definition: MovementDefinition,
  cameraAngle: CameraAngle,
): MovementCriterionEvaluation {
  const passed = definition.supportedCameraAngles.includes(cameraAngle);

  return {
    key: 'camera_angle',
    label: 'Camera angle',
    passed,
    score: passed ? 1 : 0.35,
    evidence: passed ? 'camera_angle_supported' : 'camera_angle_mismatch',
  };
}

function evaluateCriterion(
  criterion: MovementProfileCriterion,
  context: MovementProfileEvaluationContext,
): MovementCriterionEvaluation {
  const evaluator = criterionEvaluators[criterion.key as keyof typeof criterionEvaluators];

  if (!evaluator) {
    throw new Error(`Unsupported movement recognition criterion: ${criterion.key}`);
  }
  const score = evaluator(context);

  return {
    key: criterion.key,
    label: criterion.label,
    passed: score >= 0.45,
    score: clamp01(score),
    evidence: criterion.key,
  };
}

function scoreHighKneeLift(context: MovementProfileEvaluationContext): number {
  const ratio = maxKneeLiftRatio(context);

  return ratio === undefined ? 0 : ratioScore(ratio, 0.35, 0.65);
}

function scoreElbowSignal(context: MovementProfileEvaluationContext): number {
  return angleSignalScore(
    context.bodyState.jointAngles.leftElbow,
    context.bodyState.jointAngles.rightElbow,
  );
}

function scoreElbowFlexionSignal(context: MovementProfileEvaluationContext): number {
  const stats = angleRangeStats(context, (bodyState) =>
    averageDefined(bodyState.jointAngles.leftElbow, bodyState.jointAngles.rightElbow),
  );

  if (stats.sampleCount < 3) {
    return scoreElbowSignal(context);
  }

  return ratioScore(stats.range, 12, 36);
}

function scoreKneeSignal(context: MovementProfileEvaluationContext): number {
  return angleSignalScore(
    context.bodyState.jointAngles.leftKnee,
    context.bodyState.jointAngles.rightKnee,
  );
}

function scoreHipSignal(context: MovementProfileEvaluationContext): number {
  return Math.max(
    angleSignalScore(context.bodyState.jointAngles.leftHip, context.bodyState.jointAngles.rightHip),
    context.bodyState.coverage.regions.torso,
  );
}

function scoreTorsoControl(context: MovementProfileEvaluationContext): number {
  return Math.max(scoreHipSignal(context), context.bodyState.orientation.confidence);
}

function scoreBodyOrientation(context: MovementProfileEvaluationContext): number {
  return context.bodyState.orientation.confidence;
}

function scoreWristSpan(context: MovementProfileEvaluationContext): number {
  return wristSpanRatio(context) === undefined ? 0 : 1;
}

function scoreSplitStance(context: MovementProfileEvaluationContext): number {
  const ratio = ankleSpanRatio(context);
  const kneeLift = maxKneeLiftRatio(context) ?? 0;
  const kneeLiftPenalty = kneeLift > 0.18 ? 0.25 : 1;

  return ratio === undefined ? 0 : ratioScore(ratio, 0.45, 0.9) * kneeLiftPenalty;
}

function scoreAppendageSpanOscillation(context: MovementProfileEvaluationContext): number {
  const wristSpan = wristSpanRatio(context);
  const ankleSpan = ankleSpanRatio(context);

  if (wristSpan === undefined || ankleSpan === undefined) {
    return 0;
  }

  return Math.min(ratioScore(wristSpan, 0.75, 1.25), ratioScore(ankleSpan, 0.55, 0.95));
}

function scoreStandingFloorTransition(context: MovementProfileEvaluationContext): number {
  const orientations = context.window.validSamples.map((sample) =>
    bodyOrientationSignal(sample.bodyState.orientation.kind),
  );
  const hasVertical = orientations.includes('vertical');
  const hasHorizontal = orientations.includes('horizontal');
  const hasDiagonal = orientations.includes('diagonal');

  if (orientations.length < 4) {
    return 0;
  }

  if (hasVertical && hasHorizontal) {
    return 1;
  }

  if (hasHorizontal && hasDiagonal) {
    return 0.62;
  }

  return 0;
}

function scoreCompoundMotionRhythm(context: MovementProfileEvaluationContext): number {
  const transitionScore = scoreStandingFloorTransition(context);
  const verticalTravel = signalRange(context, (bodyState) => bodyState.geometry.centerOfMassY);
  const travelScore = ratioScore(verticalTravel.range, 0.18, 0.42);
  const trackingScore = Math.max(0, 1 - context.window.missingSampleRatio);

  return transitionScore * 0.55 + travelScore * 0.3 + trackingScore * 0.15;
}

function scoreVerticalCadence(context: MovementProfileEvaluationContext): number {
  const sideLiftDeltas = context.window.validSamples
    .map((sample) => kneeLiftSideDelta({ ...context, bodyState: sample.bodyState }))
    .filter((value): value is number => value !== undefined);

  if (sideLiftDeltas.length >= 3) {
    const range = Math.max(...sideLiftDeltas) - Math.min(...sideLiftDeltas);

    return ratioScore(range, 0.45, 0.95);
  }

  return scoreHighKneeLift(context);
}

function scoreHorizontalBodyLine(context: MovementProfileEvaluationContext): number {
  const deviation = bodyLineDeviation(context);

  return deviation === undefined ? 0 : 1 - ratioScore(deviation, 0.08, 0.32);
}

function scoreStaticHoldStability(context: MovementProfileEvaluationContext): number {
  const bodyLineScore = scoreHorizontalBodyLine(context);
  const trackingScore = 1 - context.window.missingSampleRatio;
  const confidenceScore = context.window.averageConfidence || context.bodyState.confidence;
  const jointStillness = scoreJointStillness(context);

  return (
    bodyLineScore * 0.34 + jointStillness * 0.32 + trackingScore * 0.17 + confidenceScore * 0.17
  );
}

function kneeLiftSideDelta(context: MovementProfileEvaluationContext): number | undefined {
  const leftHip = context.bodyState.landmarks.get('left_hip');
  const leftKnee = context.bodyState.landmarks.get('left_knee');
  const rightHip = context.bodyState.landmarks.get('right_hip');
  const rightKnee = context.bodyState.landmarks.get('right_knee');

  if (!leftHip || !leftKnee || !rightHip || !rightKnee) {
    return undefined;
  }

  return (
    leftHip.normalizedY - leftKnee.normalizedY - (rightHip.normalizedY - rightKnee.normalizedY)
  );
}

function regionCoverage(bodyState: BodyState, region: MovementRegion): number {
  switch (region) {
    case 'head':
      return bodyState.coverage.regions.head;
    case 'torso':
      return bodyState.coverage.regions.torso;
    case 'arms':
      return Math.min(bodyState.coverage.regions.leftArm, bodyState.coverage.regions.rightArm);
    case 'hands':
      return Math.min(bodyState.coverage.regions.leftHand, bodyState.coverage.regions.rightHand);
    case 'hips':
      return bodyState.coverage.regions.torso;
    case 'legs':
      return Math.min(bodyState.coverage.regions.leftLeg, bodyState.coverage.regions.rightLeg);
    case 'feet':
      return Math.max(
        Math.min(bodyState.coverage.regions.leftFoot, bodyState.coverage.regions.rightFoot),
        Math.min(bodyState.coverage.regions.leftLeg, bodyState.coverage.regions.rightLeg) * 0.8,
      );
  }
}

function angleSignalScore(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) {
    return 0;
  }

  return 1;
}

function angleRangeStats(
  context: MovementProfileEvaluationContext,
  selector: (bodyState: BodyState) => number | undefined,
): { readonly range: number; readonly sampleCount: number } {
  return signalRange(context, selector);
}

function signalRange(
  context: MovementProfileEvaluationContext,
  selector: (bodyState: BodyState) => number | undefined,
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

function scoreJointStillness(context: MovementProfileEvaluationContext): number {
  const ranges = [
    angleRangeStats(context, (bodyState) =>
      averageDefined(bodyState.jointAngles.leftElbow, bodyState.jointAngles.rightElbow),
    ),
    angleRangeStats(context, (bodyState) =>
      averageDefined(bodyState.jointAngles.leftKnee, bodyState.jointAngles.rightKnee),
    ),
    angleRangeStats(context, (bodyState) =>
      averageDefined(bodyState.jointAngles.leftHip, bodyState.jointAngles.rightHip),
    ),
  ].filter((stats) => stats.sampleCount >= 3);

  if (ranges.length === 0) {
    return 1;
  }

  const averageRange = ranges.reduce((sum, stats) => sum + stats.range, 0) / ranges.length;

  return clamp01(1 - averageRange / 28);
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function ratioScore(value: number, min: number, full: number): number {
  if (full <= min) {
    return value >= full ? 1 : 0;
  }

  return clamp01((value - min) / (full - min));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
