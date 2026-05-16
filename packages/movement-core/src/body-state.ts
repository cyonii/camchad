import {
  angleDegrees,
  distance,
  midpoint,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
  type PoseLandmarkMap,
} from '@camchad/pose-core';

export type BodyOrientationKind =
  | 'standing'
  | 'floor'
  | 'diagonal'
  | 'seated'
  | 'hanging'
  | 'ambiguous'
  | 'unknown';
export type BodyViewOrientationKind = 'front' | 'side' | 'diagonal' | 'ambiguous' | 'unknown';

export type BodyRegion =
  | 'head'
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftHand'
  | 'rightHand'
  | 'leftFoot'
  | 'rightFoot';

export interface NormalizedBodyLandmark extends PoseLandmark {
  readonly normalizedX: number;
  readonly normalizedY: number;
  readonly normalizedZ?: number;
}

export interface BodyOrientationEstimate {
  readonly kind: BodyOrientationKind;
  readonly confidence: number;
}

export interface BodyViewOrientationEstimate {
  readonly kind: BodyViewOrientationKind;
  readonly confidence: number;
}

export interface BodyCoverage {
  readonly regions: Readonly<Record<BodyRegion, number>>;
  readonly fullBody: number;
  readonly upperBody: number;
  readonly lowerBody: number;
}

export interface BodyEnvironmentQuality {
  readonly fullBodyVisible: boolean;
  readonly occlusionRisk: number;
  readonly lowConfidenceRegions: readonly BodyRegion[];
}

export interface BodyJointAngles {
  readonly leftElbow?: number;
  readonly rightElbow?: number;
  readonly leftKnee?: number;
  readonly rightKnee?: number;
  readonly leftHip?: number;
  readonly rightHip?: number;
}

export interface BodyGeometrySignals {
  readonly torsoInclinationDegrees: number;
  readonly shoulderTiltDegrees: number;
  readonly hipTiltDegrees: number;
  readonly shoulderSpanRatio?: number;
  readonly hipSpanRatio?: number;
  readonly wristSpanRatio?: number;
  readonly ankleSpanRatio?: number;
  readonly centerOfMassX: number;
  readonly centerOfMassY: number;
}

export interface BodyState {
  readonly timestampMs: number;
  readonly confidence: number;
  readonly center: { readonly x: number; readonly y: number; readonly z?: number };
  readonly scale: number;
  readonly landmarks: ReadonlyMap<LandmarkName, NormalizedBodyLandmark>;
  readonly worldLandmarks?: ReadonlyMap<LandmarkName, NormalizedBodyLandmark>;
  readonly coverage: BodyCoverage;
  readonly environment: BodyEnvironmentQuality;
  readonly orientation: BodyOrientationEstimate;
  readonly viewOrientation: BodyViewOrientationEstimate;
  readonly jointAngles: BodyJointAngles;
  readonly geometry: BodyGeometrySignals;
}

export function extractBodyState(frame: PoseFrame | undefined): BodyState | undefined {
  if (!frame) {
    return undefined;
  }

  const leftShoulder = frame.landmarks.get('left_shoulder');
  const rightShoulder = frame.landmarks.get('right_shoulder');
  const leftHip = frame.landmarks.get('left_hip');
  const rightHip = frame.landmarks.get('right_hip');

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return undefined;
  }

  const shoulderCenter = midpoint3D(leftShoulder, rightShoulder);
  const hipCenter = midpoint3D(leftHip, rightHip);
  const center = midpoint3D(shoulderCenter, hipCenter);
  const scale = Math.max(0.001, distance(shoulderCenter, hipCenter));
  const normalizedLandmarks = normalizeLandmarks(frame, center, scale);
  const normalizedWorldLandmarks = normalizeWorldLandmarks(frame);
  const coverage = computeBodyCoverage(frame);
  const geometry = computeGeometrySignals(frame, shoulderCenter, hipCenter, scale);

  return {
    timestampMs: frame.timestampMs,
    confidence: frame.confidence,
    center,
    scale,
    landmarks: normalizedLandmarks,
    worldLandmarks: normalizedWorldLandmarks,
    coverage,
    environment: computeEnvironmentQuality(coverage),
    orientation: estimateBodyOrientation(frame, shoulderCenter, hipCenter),
    viewOrientation: estimateViewOrientation(geometry),
    jointAngles: computeJointAngles(frame),
    geometry,
  };
}

function normalizeLandmarks(
  frame: PoseFrame,
  center: { readonly x: number; readonly y: number; readonly z?: number },
  scale: number,
): ReadonlyMap<LandmarkName, NormalizedBodyLandmark> {
  return normalizeLandmarkMap(frame.landmarks, center, scale);
}

function normalizeWorldLandmarks(
  frame: PoseFrame,
): ReadonlyMap<LandmarkName, NormalizedBodyLandmark> | undefined {
  if (!frame.worldLandmarks) {
    return undefined;
  }

  const leftShoulder = frame.worldLandmarks.get('left_shoulder');
  const rightShoulder = frame.worldLandmarks.get('right_shoulder');
  const leftHip = frame.worldLandmarks.get('left_hip');
  const rightHip = frame.worldLandmarks.get('right_hip');

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return undefined;
  }

  const shoulderCenter = midpoint3D(leftShoulder, rightShoulder);
  const hipCenter = midpoint3D(leftHip, rightHip);
  const center = midpoint3D(shoulderCenter, hipCenter);
  const scale = Math.max(0.001, distance(shoulderCenter, hipCenter));

  return normalizeLandmarkMap(frame.worldLandmarks, center, scale);
}

function computeBodyCoverage(frame: PoseFrame): BodyCoverage {
  const regions: Record<BodyRegion, number> = {
    head: regionVisibility(frame, ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear']),
    torso: regionVisibility(frame, ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']),
    leftArm: regionVisibility(frame, ['left_shoulder', 'left_elbow', 'left_wrist']),
    rightArm: regionVisibility(frame, ['right_shoulder', 'right_elbow', 'right_wrist']),
    leftLeg: regionVisibility(frame, ['left_hip', 'left_knee', 'left_ankle']),
    rightLeg: regionVisibility(frame, ['right_hip', 'right_knee', 'right_ankle']),
    leftHand: regionVisibility(frame, ['left_wrist', 'left_pinky', 'left_index', 'left_thumb']),
    rightHand: regionVisibility(frame, [
      'right_wrist',
      'right_pinky',
      'right_index',
      'right_thumb',
    ]),
    leftFoot: regionVisibility(frame, ['left_ankle', 'left_heel', 'left_foot_index']),
    rightFoot: regionVisibility(frame, ['right_ankle', 'right_heel', 'right_foot_index']),
  };

  return {
    regions,
    fullBody: average(Object.values(regions)),
    upperBody: average([regions.head, regions.torso, regions.leftArm, regions.rightArm]),
    lowerBody: average([regions.leftLeg, regions.rightLeg, regions.leftFoot, regions.rightFoot]),
  };
}

function computeEnvironmentQuality(coverage: BodyCoverage): BodyEnvironmentQuality {
  const lowConfidenceRegions = Object.entries(coverage.regions)
    .filter(([, score]) => score < 0.45)
    .map(([region]) => region as BodyRegion);

  return {
    fullBodyVisible: coverage.fullBody >= 0.72,
    occlusionRisk: clamp01(lowConfidenceRegions.length / Object.keys(coverage.regions).length),
    lowConfidenceRegions,
  };
}

function normalizeLandmarkMap(
  landmarks: PoseLandmarkMap,
  center: { readonly x: number; readonly y: number; readonly z?: number },
  scale: number,
): ReadonlyMap<LandmarkName, NormalizedBodyLandmark> {
  return new Map(
    [...landmarks.entries()].map(([name, landmark]) => [
      name,
      {
        ...landmark,
        normalizedX: (landmark.x - center.x) / scale,
        normalizedY: (landmark.y - center.y) / scale,
        normalizedZ:
          landmark.z === undefined || center.z === undefined
            ? landmark.z
            : (landmark.z - center.z) / scale,
      },
    ]),
  );
}

function computeJointAngles(frame: PoseFrame): BodyJointAngles {
  return {
    leftElbow: jointAngle(frame, 'left_shoulder', 'left_elbow', 'left_wrist'),
    rightElbow: jointAngle(frame, 'right_shoulder', 'right_elbow', 'right_wrist'),
    leftKnee: jointAngle(frame, 'left_hip', 'left_knee', 'left_ankle'),
    rightKnee: jointAngle(frame, 'right_hip', 'right_knee', 'right_ankle'),
    leftHip: jointAngle(frame, 'left_shoulder', 'left_hip', 'left_knee'),
    rightHip: jointAngle(frame, 'right_shoulder', 'right_hip', 'right_knee'),
  };
}

function computeGeometrySignals(
  frame: PoseFrame,
  shoulderCenter: { readonly x: number; readonly y: number },
  hipCenter: { readonly x: number; readonly y: number },
  scale: number,
): BodyGeometrySignals {
  const leftShoulder = frame.landmarks.get('left_shoulder');
  const rightShoulder = frame.landmarks.get('right_shoulder');
  const leftHip = frame.landmarks.get('left_hip');
  const rightHip = frame.landmarks.get('right_hip');
  const leftWrist = frame.landmarks.get('left_wrist');
  const rightWrist = frame.landmarks.get('right_wrist');
  const leftAnkle = frame.landmarks.get('left_ankle');
  const rightAnkle = frame.landmarks.get('right_ankle');

  return {
    torsoInclinationDegrees: angleFromVertical(shoulderCenter, hipCenter),
    shoulderTiltDegrees:
      leftShoulder && rightShoulder ? angleFromHorizontal(leftShoulder, rightShoulder) : 0,
    hipTiltDegrees: leftHip && rightHip ? angleFromHorizontal(leftHip, rightHip) : 0,
    shoulderSpanRatio:
      leftShoulder && rightShoulder ? distance(leftShoulder, rightShoulder) / scale : undefined,
    hipSpanRatio: leftHip && rightHip ? distance(leftHip, rightHip) / scale : undefined,
    wristSpanRatio: leftWrist && rightWrist ? distance(leftWrist, rightWrist) / scale : undefined,
    ankleSpanRatio: leftAnkle && rightAnkle ? distance(leftAnkle, rightAnkle) / scale : undefined,
    centerOfMassX: (shoulderCenter.x + hipCenter.x * 2) / 3,
    centerOfMassY: (shoulderCenter.y + hipCenter.y * 2) / 3,
  };
}

function estimateBodyOrientation(
  frame: PoseFrame,
  shoulderCenter: { readonly x: number; readonly y: number },
  hipCenter: { readonly x: number; readonly y: number },
): BodyOrientationEstimate {
  const dx = Math.abs(shoulderCenter.x - hipCenter.x);
  const dy = Math.abs(shoulderCenter.y - hipCenter.y);
  const total = dx + dy;

  if (total <= 0.001) {
    return { kind: 'unknown', confidence: 0 };
  }

  const hangingConfidence = hangingPostureConfidence(frame, shoulderCenter);

  if (hangingConfidence > 0.62) {
    return { kind: 'hanging', confidence: hangingConfidence };
  }

  if (dx > dy * 1.2) {
    return { kind: 'floor', confidence: clamp01(dx / total) };
  }

  const seatedConfidence = seatedPostureConfidence(frame, hipCenter);

  if (seatedConfidence > 0.62) {
    return { kind: 'seated', confidence: seatedConfidence };
  }

  if (dy > dx * 1.6) {
    return { kind: 'standing', confidence: clamp01(dy / total) };
  }

  if (Math.abs(dx - dy) / total < 0.08) {
    return { kind: 'ambiguous', confidence: 0.35 };
  }

  return { kind: 'diagonal', confidence: 0.58 };
}

function seatedPostureConfidence(frame: PoseFrame, hipCenter: { readonly y: number }): number {
  const leftKnee = frame.landmarks.get('left_knee');
  const rightKnee = frame.landmarks.get('right_knee');

  if (!leftKnee && !rightKnee) {
    return 0;
  }

  const kneeY = average(
    [leftKnee, rightKnee]
      .filter((landmark): landmark is PoseLandmark => landmark !== undefined)
      .map((landmark) => landmark.y),
  );
  const hipKneeVerticalGap = Math.abs(kneeY - hipCenter.y);

  return clamp01((0.16 - hipKneeVerticalGap) / 0.16);
}

function hangingPostureConfidence(
  frame: PoseFrame,
  shoulderCenter: { readonly y: number },
): number {
  const leftWrist = frame.landmarks.get('left_wrist');
  const rightWrist = frame.landmarks.get('right_wrist');

  if (!leftWrist && !rightWrist) {
    return 0;
  }

  const wristY = average(
    [leftWrist, rightWrist]
      .filter((landmark): landmark is PoseLandmark => landmark !== undefined)
      .map((landmark) => landmark.y),
  );

  return clamp01((shoulderCenter.y - wristY - 0.08) / 0.18);
}

function estimateViewOrientation(geometry: BodyGeometrySignals): BodyViewOrientationEstimate {
  const shoulderSpan = geometry.shoulderSpanRatio;
  const hipSpan = geometry.hipSpanRatio;

  if (shoulderSpan === undefined || hipSpan === undefined) {
    return { kind: 'unknown', confidence: 0 };
  }

  const averageSpan = (shoulderSpan + hipSpan) / 2;

  if (averageSpan <= 0.18) {
    return { kind: 'side', confidence: clamp01((0.18 - averageSpan) / 0.18) };
  }

  if (averageSpan >= 0.72) {
    return { kind: 'front', confidence: clamp01((averageSpan - 0.72) / 0.5) };
  }

  if (averageSpan >= 0.42 && averageSpan <= 0.58) {
    return { kind: 'ambiguous', confidence: 0.42 };
  }

  return { kind: 'diagonal', confidence: 0.58 };
}

function regionVisibility(frame: PoseFrame, names: readonly LandmarkName[]): number {
  return average(
    names.map((name) => {
      const landmark = frame.landmarks.get(name);

      return landmark ? landmarkVisibility(landmark, frame.confidence) : 0;
    }),
  );
}

function jointAngle(
  frame: PoseFrame,
  a: LandmarkName,
  vertex: LandmarkName,
  c: LandmarkName,
): number | undefined {
  const first = frame.landmarks.get(a);
  const middle = frame.landmarks.get(vertex);
  const last = frame.landmarks.get(c);

  return first && middle && last ? angleDegrees(first, middle, last) : undefined;
}

function angleFromVertical(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return (Math.atan2(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 180) / Math.PI;
}

function angleFromHorizontal(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return (Math.atan2(Math.abs(a.y - b.y), Math.abs(a.x - b.x)) * 180) / Math.PI;
}

function landmarkVisibility(landmark: PoseLandmark, fallback: number): number {
  return landmark.visibility ?? landmark.presence ?? fallback;
}

function midpoint3D(
  a: { readonly x: number; readonly y: number; readonly z?: number },
  b: { readonly x: number; readonly y: number; readonly z?: number },
): { readonly x: number; readonly y: number; readonly z?: number } {
  const point = midpoint(a, b);

  return {
    ...point,
    z: a.z === undefined || b.z === undefined ? undefined : (a.z + b.z) / 2,
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
