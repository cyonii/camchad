import {
  toLandmarkMap,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';

interface PushUpFrameOptions {
  readonly timestampMs: number;
  readonly elbowAngle: number;
  readonly hipOffsetY?: number;
  readonly visibility?: number;
  readonly leftVisibility?: number;
  readonly rightVisibility?: number;
}

interface SquatFrameOptions {
  readonly timestampMs: number;
  readonly kneeAngle: number;
  readonly torsoLeanX?: number;
  readonly visibility?: number;
}

export function makePushUpFrame(options: PushUpFrameOptions): PoseFrame {
  const visibility = options.visibility ?? 0.95;
  const leftVisibility = options.leftVisibility ?? visibility;
  const rightVisibility = options.rightVisibility ?? visibility;
  const shoulder = { x: 0.25, y: 0.5 };
  const upperArmLength = 0.16;
  const forearmLength = 0.16;
  const elbow = {
    x: shoulder.x + upperArmLength,
    y: shoulder.y,
  };
  const radians = ((180 - options.elbowAngle) * Math.PI) / 180;
  const wrist = {
    x: elbow.x + Math.cos(radians) * forearmLength,
    y: elbow.y + Math.sin(radians) * forearmLength,
  };
  const hipY = 0.5 + (options.hipOffsetY ?? 0);
  const left = sideLandmarks('left', shoulder, elbow, wrist, hipY, leftVisibility);
  const right = sideLandmarks(
    'right',
    { x: shoulder.x, y: shoulder.y + 0.01 },
    { x: elbow.x, y: elbow.y + 0.01 },
    { x: wrist.x, y: wrist.y + 0.01 },
    hipY + 0.01,
    rightVisibility,
  );

  return {
    timestampMs: options.timestampMs,
    landmarks: toLandmarkMap([...left, ...right]),
    confidence: Math.max(leftVisibility, rightVisibility),
  };
}

export function makeSquatFrame(options: SquatFrameOptions): PoseFrame {
  const visibility = options.visibility ?? 0.95;
  const shoulder = { x: 0.5 + (options.torsoLeanX ?? 0), y: 0.24 };
  const hip = { x: 0.5, y: 0.45 };
  const knee = { x: 0.5, y: 0.65 };
  const lowerLegLength = 0.22;
  const radians = ((-90 + options.kneeAngle) * Math.PI) / 180;
  const ankle = {
    x: knee.x + Math.cos(radians) * lowerLegLength,
    y: knee.y + Math.sin(radians) * lowerLegLength,
  };

  const left = standingSideLandmarks('left', shoulder, hip, knee, ankle, visibility);
  const right = standingSideLandmarks(
    'right',
    { x: shoulder.x + 0.02, y: shoulder.y },
    { x: hip.x + 0.02, y: hip.y },
    { x: knee.x + 0.02, y: knee.y },
    { x: ankle.x + 0.02, y: ankle.y },
    visibility,
  );

  return {
    timestampMs: options.timestampMs,
    landmarks: toLandmarkMap([...left, ...right]),
    confidence: visibility,
  };
}

function sideLandmarks(
  side: 'left' | 'right',
  shoulder: { readonly x: number; readonly y: number },
  elbow: { readonly x: number; readonly y: number },
  wrist: { readonly x: number; readonly y: number },
  hipY: number,
  visibility: number,
): PoseLandmark[] {
  const names = {
    shoulder: `${side}_shoulder` as LandmarkName,
    elbow: `${side}_elbow` as LandmarkName,
    wrist: `${side}_wrist` as LandmarkName,
    hip: `${side}_hip` as LandmarkName,
    knee: `${side}_knee` as LandmarkName,
    ankle: `${side}_ankle` as LandmarkName,
  };

  return [
    landmark(names.shoulder, shoulder.x, shoulder.y, visibility),
    landmark(names.elbow, elbow.x, elbow.y, visibility),
    landmark(names.wrist, wrist.x, wrist.y, visibility),
    landmark(names.hip, 0.5, hipY, visibility),
    landmark(names.knee, 0.68, hipY, visibility),
    landmark(names.ankle, 0.86, hipY, visibility),
  ];
}

function standingSideLandmarks(
  side: 'left' | 'right',
  shoulder: { readonly x: number; readonly y: number },
  hip: { readonly x: number; readonly y: number },
  knee: { readonly x: number; readonly y: number },
  ankle: { readonly x: number; readonly y: number },
  visibility: number,
): PoseLandmark[] {
  const names = {
    shoulder: `${side}_shoulder` as LandmarkName,
    elbow: `${side}_elbow` as LandmarkName,
    wrist: `${side}_wrist` as LandmarkName,
    hip: `${side}_hip` as LandmarkName,
    knee: `${side}_knee` as LandmarkName,
    ankle: `${side}_ankle` as LandmarkName,
  };

  return [
    landmark(names.shoulder, shoulder.x, shoulder.y, visibility),
    landmark(names.elbow, shoulder.x + 0.02, shoulder.y + 0.16, visibility),
    landmark(names.wrist, shoulder.x + 0.02, shoulder.y + 0.32, visibility),
    landmark(names.hip, hip.x, hip.y, visibility),
    landmark(names.knee, knee.x, knee.y, visibility),
    landmark(names.ankle, ankle.x, ankle.y, visibility),
  ];
}

function landmark(name: LandmarkName, x: number, y: number, visibility: number): PoseLandmark {
  return {
    name,
    x,
    y,
    z: 0,
    visibility,
    presence: visibility,
  };
}
