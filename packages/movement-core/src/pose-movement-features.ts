import {
  angleDegrees,
  lineDeviationRatio,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';

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
  readonly hipCenterY?: number;
  readonly kneeCenterY?: number;
  readonly ankleSpanRatio?: number;
  readonly wristSpanRatio?: number;
  readonly kneeLiftRatio?: number;
}

export function extractPoseMovementFeatures(
  frame: PoseFrame | undefined,
  minVisibility = 0.45,
): PoseMovementFeatures | undefined {
  if (!frame) {
    return undefined;
  }

  const shoulderCenter = centerLandmark(frame, 'left_shoulder', 'right_shoulder', minVisibility);
  const hipCenter = centerLandmark(frame, 'left_hip', 'right_hip', minVisibility);

  if (!shoulderCenter || !hipCenter) {
    return undefined;
  }

  const bodyScale = Math.max(0.001, distance(shoulderCenter, hipCenter));
  const orientation = classifyBodyOrientation(shoulderCenter, hipCenter);
  const sideFeatures = (['left', 'right'] as const).flatMap((side) =>
    readSideFeatures(frame, side, minVisibility),
  );
  const kneeCenter = centerLandmark(frame, 'left_knee', 'right_knee', minVisibility);
  const leftAnkle = visibleLandmark(frame, 'left_ankle', minVisibility);
  const rightAnkle = visibleLandmark(frame, 'right_ankle', minVisibility);
  const leftWrist = visibleLandmark(frame, 'left_wrist', minVisibility);
  const rightWrist = visibleLandmark(frame, 'right_wrist', minVisibility);

  return {
    timestampMs: frame.timestampMs,
    poseConfidence: frame.confidence,
    movementConfidence: clamp01(frame.confidence * 0.65 + orientation.score * 0.35),
    bodyOrientation: orientation.value,
    bodyOrientationScore: orientation.score,
    averageElbowAngle: average(sideFeatures.map((feature) => feature.elbowAngle)),
    averageKneeAngle: average(sideFeatures.map((feature) => feature.kneeAngle)),
    averageHipAngle: average(sideFeatures.map((feature) => feature.hipAngle)),
    bodyLineDeviation: average(sideFeatures.map((feature) => feature.bodyLineDeviation)),
    torsoInclinationDegrees: angleFromVertical(shoulderCenter, hipCenter),
    shoulderCenterY: shoulderCenter.y,
    hipCenterY: hipCenter.y,
    kneeCenterY: kneeCenter?.y,
    ankleSpanRatio:
      leftAnkle && rightAnkle ? Math.abs(leftAnkle.x - rightAnkle.x) / bodyScale : undefined,
    wristSpanRatio:
      leftWrist && rightWrist ? Math.abs(leftWrist.x - rightWrist.x) / bodyScale : undefined,
    kneeLiftRatio: kneeCenter ? (hipCenter.y - kneeCenter.y) / bodyScale : undefined,
  };
}

interface SideFeatures {
  readonly elbowAngle: number;
  readonly kneeAngle: number;
  readonly hipAngle: number;
  readonly bodyLineDeviation: number;
}

function readSideFeatures(
  frame: PoseFrame,
  side: 'left' | 'right',
  minVisibility: number,
): readonly SideFeatures[] {
  const shoulder = visibleLandmark(frame, `${side}_shoulder` as LandmarkName, minVisibility);
  const elbow = visibleLandmark(frame, `${side}_elbow` as LandmarkName, minVisibility);
  const wrist = visibleLandmark(frame, `${side}_wrist` as LandmarkName, minVisibility);
  const hip = visibleLandmark(frame, `${side}_hip` as LandmarkName, minVisibility);
  const knee = visibleLandmark(frame, `${side}_knee` as LandmarkName, minVisibility);
  const ankle = visibleLandmark(frame, `${side}_ankle` as LandmarkName, minVisibility);

  if (!shoulder || !elbow || !wrist || !hip || !knee || !ankle) {
    return [];
  }

  return [
    {
      elbowAngle: angleDegrees(shoulder, elbow, wrist),
      kneeAngle: angleDegrees(hip, knee, ankle),
      hipAngle: angleDegrees(shoulder, hip, knee),
      bodyLineDeviation: lineDeviationRatio(shoulder, hip, ankle),
    },
  ];
}

function centerLandmark(
  frame: PoseFrame,
  a: LandmarkName,
  b: LandmarkName,
  minVisibility: number,
): PoseLandmark | undefined {
  const first = visibleLandmark(frame, a, minVisibility);
  const second = visibleLandmark(frame, b, minVisibility);

  if (!first || !second) {
    return undefined;
  }

  return {
    name: a,
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    z: ((first.z ?? 0) + (second.z ?? 0)) / 2,
    visibility: Math.min(first.visibility ?? 0, second.visibility ?? 0),
  };
}

function visibleLandmark(
  frame: PoseFrame,
  name: LandmarkName,
  minVisibility: number,
): PoseLandmark | undefined {
  const landmark = frame.landmarks.get(name);

  if (!landmark || landmarkVisibility(landmark) < minVisibility) {
    return undefined;
  }

  return landmark;
}

function classifyBodyOrientation(
  shoulderCenter: PoseLandmark,
  hipCenter: PoseLandmark,
): { readonly value: BodyOrientation; readonly score: number } {
  const dx = Math.abs(shoulderCenter.x - hipCenter.x);
  const dy = Math.abs(shoulderCenter.y - hipCenter.y);
  const total = dx + dy;

  if (total <= 0.001) {
    return { value: 'unknown', score: 0 };
  }

  if (dy > dx * 1.6) {
    return { value: 'vertical', score: clamp01(dy / total) };
  }

  if (dx > dy * 1.2) {
    return { value: 'horizontal', score: clamp01(dx / total) };
  }

  return { value: 'diagonal', score: 0.58 };
}

function angleFromVertical(a: PoseLandmark, b: PoseLandmark): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);

  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

function landmarkVisibility(landmark: PoseLandmark): number {
  return landmark.visibility ?? landmark.presence ?? 0;
}

function distance(a: PoseLandmark, b: PoseLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(values: readonly (number | undefined)[]): number | undefined {
  const finiteValues = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );

  if (finiteValues.length === 0) {
    return undefined;
  }

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
