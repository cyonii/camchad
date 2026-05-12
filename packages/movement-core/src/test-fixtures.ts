import {
  toLandmarkMap,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@home-activity/pose-core';

interface PushUpFrameOptions {
  readonly timestampMs: number;
  readonly elbowAngle: number;
  readonly hipOffsetY?: number;
  readonly visibility?: number;
  readonly leftVisibility?: number;
  readonly rightVisibility?: number;
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
