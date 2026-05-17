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
  const key = criterion.key;
  const specificScore = evaluateSpecificCriterion(key, context);

  if (specificScore !== undefined) {
    return {
      key: criterion.key,
      label: criterion.label,
      passed: specificScore >= 0.45,
      score: clamp01(specificScore),
      evidence: criterion.key,
    };
  }

  const bodyState = context.bodyState;
  const window = context.window;
  let score = bodyState.confidence;

  if (key.includes('elbow')) {
    score = angleSignalScore(bodyState.jointAngles.leftElbow, bodyState.jointAngles.rightElbow);
  } else if (key.includes('knee')) {
    score = angleSignalScore(bodyState.jointAngles.leftKnee, bodyState.jointAngles.rightKnee);
  } else if (key.includes('hip') || key.includes('torso')) {
    score = Math.max(
      angleSignalScore(bodyState.jointAngles.leftHip, bodyState.jointAngles.rightHip),
      bodyState.coverage.regions.torso,
    );
  } else if (key.includes('body_line') || key.includes('stability')) {
    const deviation = bodyLineDeviation(context);
    score =
      deviation === undefined
        ? bodyState.orientation.confidence
        : 1 - Math.min(1, deviation / 0.35);
  } else if (key.includes('span') || key.includes('abduction')) {
    score = wristSpanRatio(context) !== undefined || ankleSpanRatio(context) !== undefined ? 1 : 0;
  } else if (key.includes('hold') || key.includes('static')) {
    score = Math.max(0, 1 - window.missingSampleRatio);
  } else if (key.includes('orientation')) {
    score = bodyState.orientation.confidence;
  }

  return {
    key: criterion.key,
    label: criterion.label,
    passed: score >= 0.45,
    score: clamp01(score),
    evidence: criterion.key,
  };
}

function evaluateSpecificCriterion(
  key: string,
  context: MovementProfileEvaluationContext,
): number | undefined {
  switch (key) {
    case 'alternating_knee_lift':
      return scoreHighKneeLift(context);
    case 'vertical_cadence':
      return scoreVerticalCadence(context);
    case 'horizontal_body_line':
      return scoreHorizontalBodyLine(context);
    case 'static_hold_stability':
      return scoreStaticHoldStability(context);
    default:
      return undefined;
  }
}

function scoreHighKneeLift(context: MovementProfileEvaluationContext): number {
  const ratio = maxKneeLiftRatio(context);

  return ratio === undefined ? 0 : ratioScore(ratio, 0.35, 0.65);
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

  return bodyLineScore * 0.5 + trackingScore * 0.25 + confidenceScore * 0.25;
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
