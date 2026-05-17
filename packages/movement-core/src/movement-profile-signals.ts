import type { LandmarkName } from '@camchad/pose-core';

import type { BodyOrientationKind, BodyState, NormalizedBodyLandmark } from './body-state.js';
import type { MovementProfileEvaluationContext } from './movement-profile-evaluation-context.js';

export type BodyOrientationSignal = 'vertical' | 'horizontal' | 'diagonal' | 'unknown';

export function bodyOrientationSignal(kind: BodyOrientationKind): BodyOrientationSignal {
  switch (kind) {
    case 'standing':
    case 'hanging':
      return 'vertical';
    case 'floor':
      return 'horizontal';
    case 'diagonal':
    case 'seated':
    case 'ambiguous':
      return 'diagonal';
    case 'unknown':
      return 'unknown';
  }
}

export function movementConfidence(context: MovementProfileEvaluationContext): number {
  return clamp01(
    context.bodyState.confidence * 0.65 + context.bodyState.orientation.confidence * 0.35,
  );
}

export function bodyOrientationScore(context: MovementProfileEvaluationContext): number {
  return context.bodyState.orientation.confidence;
}

export function averageElbowAngle(context: MovementProfileEvaluationContext): number | undefined {
  return averageDefined(
    context.bodyState.jointAngles.leftElbow,
    context.bodyState.jointAngles.rightElbow,
  );
}

export function averageKneeAngle(context: MovementProfileEvaluationContext): number | undefined {
  return averageDefined(
    context.bodyState.jointAngles.leftKnee,
    context.bodyState.jointAngles.rightKnee,
  );
}

export function averageHipAngle(context: MovementProfileEvaluationContext): number | undefined {
  return averageDefined(
    context.bodyState.jointAngles.leftHip,
    context.bodyState.jointAngles.rightHip,
  );
}

export function bodyLineDeviation(context: MovementProfileEvaluationContext): number | undefined {
  return context.bodyState.geometry.bodyLineDeviation;
}

export function torsoInclinationDegrees(context: MovementProfileEvaluationContext): number {
  return context.bodyState.geometry.torsoInclinationDegrees;
}

export function ankleSpanRatio(context: MovementProfileEvaluationContext): number | undefined {
  return context.bodyState.geometry.ankleSpanRatio;
}

export function wristSpanRatio(context: MovementProfileEvaluationContext): number | undefined {
  return context.bodyState.geometry.wristSpanRatio;
}

export function wristElevationRatio(context: MovementProfileEvaluationContext): number | undefined {
  const shoulderCenter = landmarkCenter(
    context.bodyState,
    'left_shoulder',
    'right_shoulder',
    context.minVisibility,
  );
  const wristCenter = landmarkCenter(
    context.bodyState,
    'left_wrist',
    'right_wrist',
    context.minVisibility,
  );

  return shoulderCenter && wristCenter
    ? shoulderCenter.normalizedY - wristCenter.normalizedY
    : undefined;
}

export function kneeLiftRatio(context: MovementProfileEvaluationContext): number | undefined {
  return bodyKneeLiftRatio(context.bodyState, context.minVisibility);
}

export function maxKneeLiftRatio(context: MovementProfileEvaluationContext): number | undefined {
  return bodyMaxKneeLiftRatio(context.bodyState, context.minVisibility);
}

export function bodyKneeLiftRatio(bodyState: BodyState, minVisibility: number): number | undefined {
  const hipCenter = landmarkCenter(bodyState, 'left_hip', 'right_hip', minVisibility);
  const kneeCenter = landmarkCenter(bodyState, 'left_knee', 'right_knee', minVisibility);

  return hipCenter && kneeCenter ? hipCenter.normalizedY - kneeCenter.normalizedY : undefined;
}

export function bodyMaxKneeLiftRatio(
  bodyState: BodyState,
  minVisibility: number,
): number | undefined {
  const hipCenter = landmarkCenter(bodyState, 'left_hip', 'right_hip', minVisibility);

  if (!hipCenter) {
    return undefined;
  }

  const leftKnee = visibleLandmark(bodyState, 'left_knee', minVisibility);
  const rightKnee = visibleLandmark(bodyState, 'right_knee', minVisibility);

  return maxDefined(
    leftKnee ? hipCenter.normalizedY - leftKnee.normalizedY : undefined,
    rightKnee ? hipCenter.normalizedY - rightKnee.normalizedY : undefined,
  );
}

function landmarkCenter(
  bodyState: BodyState,
  a: LandmarkName,
  b: LandmarkName,
  minVisibility: number,
): NormalizedBodyLandmark | undefined {
  const first = visibleLandmark(bodyState, a, minVisibility);
  const second = visibleLandmark(bodyState, b, minVisibility);

  if (!first || !second) {
    return undefined;
  }

  return {
    ...first,
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    z: ((first.z ?? 0) + (second.z ?? 0)) / 2,
    normalizedX: (first.normalizedX + second.normalizedX) / 2,
    normalizedY: (first.normalizedY + second.normalizedY) / 2,
    normalizedZ:
      first.normalizedZ === undefined || second.normalizedZ === undefined
        ? undefined
        : (first.normalizedZ + second.normalizedZ) / 2,
    visibility: Math.min(first.visibility ?? 0, second.visibility ?? 0),
    presence: Math.min(first.presence ?? 0, second.presence ?? 0),
  };
}

function visibleLandmark(
  bodyState: BodyState,
  name: LandmarkName,
  minVisibility: number,
): NormalizedBodyLandmark | undefined {
  const landmark = bodyState.landmarks.get(name);

  if (!landmark || landmarkVisibility(landmark) < minVisibility) {
    return undefined;
  }

  return landmark;
}

function landmarkVisibility(landmark: NormalizedBodyLandmark): number {
  return landmark.visibility ?? landmark.presence ?? 0;
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

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) {
    return b;
  }

  if (b === undefined) {
    return a;
  }

  return Math.max(a, b);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
