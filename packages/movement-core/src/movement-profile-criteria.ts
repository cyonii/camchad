import type { BodyState } from './body-state.js';
import type { CameraAngle } from './movement-interpreter.js';
import type {
  MovementDefinition,
  MovementProfileCriterion,
  MovementRegion,
} from './movement-registry.js';
import type { MovementProfileEvaluationContext } from './movement-profile-evaluation-context.js';

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
  const bodyState = context.bodyState;
  const features = context.features;
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
    score =
      features.bodyLineDeviation === undefined
        ? bodyState.orientation.confidence
        : 1 - Math.min(1, features.bodyLineDeviation / 0.35);
  } else if (key.includes('span') || key.includes('abduction')) {
    score = features.wristSpanRatio !== undefined || features.ankleSpanRatio !== undefined ? 1 : 0;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
