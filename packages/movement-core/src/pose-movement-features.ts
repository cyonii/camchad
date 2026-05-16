import type { LandmarkName, PoseFrame } from '@camchad/pose-core';

import {
  extractBodyState,
  type BodyOrientationKind,
  type BodyState,
  type NormalizedBodyLandmark,
} from './body-state.js';

export type BodyOrientation = 'vertical' | 'horizontal' | 'diagonal' | 'unknown';

export interface PoseMovementFeatures {
  readonly timestampMs: number;
  readonly poseConfidence: number;
  readonly movementConfidence: number;
  readonly bodyOrientation: BodyOrientation;
  readonly bodyOrientationScore: number;
  readonly averageElbowAngle?: number;
  readonly averageKneeAngle?: number;
  readonly averageHipAngle?: number;
  readonly bodyLineDeviation?: number;
  readonly torsoInclinationDegrees?: number;
  readonly shoulderCenterY?: number;
  readonly wristCenterY?: number;
  readonly hipCenterY?: number;
  readonly kneeCenterY?: number;
  readonly ankleCenterY?: number;
  readonly ankleSpanRatio?: number;
  readonly wristSpanRatio?: number;
  readonly wristElevationRatio?: number;
  readonly kneeLiftRatio?: number;
  readonly maxKneeLiftRatio?: number;
}

export function extractPoseMovementFeatures(
  frame: PoseFrame | undefined,
  minVisibility = 0.45,
): PoseMovementFeatures | undefined {
  const bodyState = extractBodyState(frame);

  if (!bodyState) {
    return undefined;
  }

  return poseMovementFeaturesFromBodyState(bodyState, minVisibility);
}

export function poseMovementFeaturesFromBodyState(
  bodyState: BodyState,
  minVisibility = 0.45,
): PoseMovementFeatures | undefined {
  if (!bodyState || bodyState.coverage.regions.torso < minVisibility) {
    return undefined;
  }

  const shoulderCenter = landmarkCenter(
    bodyState,
    'left_shoulder',
    'right_shoulder',
    minVisibility,
  );
  const hipCenter = landmarkCenter(bodyState, 'left_hip', 'right_hip', minVisibility);

  if (!shoulderCenter || !hipCenter) {
    return undefined;
  }

  const wristCenter = landmarkCenter(bodyState, 'left_wrist', 'right_wrist', minVisibility);
  const kneeCenter = landmarkCenter(bodyState, 'left_knee', 'right_knee', minVisibility);
  const ankleCenter = landmarkCenter(bodyState, 'left_ankle', 'right_ankle', minVisibility);
  const leftKnee = visibleLandmark(bodyState, 'left_knee', minVisibility);
  const rightKnee = visibleLandmark(bodyState, 'right_knee', minVisibility);
  const orientation = bodyOrientationFor(bodyState.orientation.kind);

  return {
    timestampMs: bodyState.timestampMs,
    poseConfidence: bodyState.confidence,
    movementConfidence: clamp01(
      bodyState.confidence * 0.65 + bodyState.orientation.confidence * 0.35,
    ),
    bodyOrientation: orientation,
    bodyOrientationScore: bodyState.orientation.confidence,
    averageElbowAngle: averageDefined(
      bodyState.jointAngles.leftElbow,
      bodyState.jointAngles.rightElbow,
    ),
    averageKneeAngle: averageDefined(
      bodyState.jointAngles.leftKnee,
      bodyState.jointAngles.rightKnee,
    ),
    averageHipAngle: averageDefined(bodyState.jointAngles.leftHip, bodyState.jointAngles.rightHip),
    bodyLineDeviation: bodyState.geometry.bodyLineDeviation,
    torsoInclinationDegrees: bodyState.geometry.torsoInclinationDegrees,
    shoulderCenterY: shoulderCenter.y,
    wristCenterY: wristCenter?.y,
    hipCenterY: hipCenter.y,
    kneeCenterY: kneeCenter?.y,
    ankleCenterY: ankleCenter?.y,
    ankleSpanRatio: bodyState.geometry.ankleSpanRatio,
    wristSpanRatio: bodyState.geometry.wristSpanRatio,
    wristElevationRatio: wristCenter
      ? shoulderCenter.normalizedY - wristCenter.normalizedY
      : undefined,
    kneeLiftRatio: kneeCenter ? hipCenter.normalizedY - kneeCenter.normalizedY : undefined,
    maxKneeLiftRatio: maxDefined(
      leftKnee ? hipCenter.normalizedY - leftKnee.normalizedY : undefined,
      rightKnee ? hipCenter.normalizedY - rightKnee.normalizedY : undefined,
    ),
  };
}

function bodyOrientationFor(kind: BodyOrientationKind): BodyOrientation {
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
