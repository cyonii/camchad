import {
  toLandmarkMap,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';

import type { MovementInterpreter, MovementInterpreterState } from './movement-interpreter.js';
import type { MovementRecognitionEngineState } from './movement-recognition-engine.js';

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

export type PoseSequence = readonly (PoseFrame | undefined)[];

export interface MovementReplayResult {
  readonly states: readonly MovementInterpreterState[];
  readonly finalState: MovementInterpreterState;
  readonly phaseChanges: readonly MovementInterpreterState[];
  readonly repEvents: readonly NonNullable<MovementInterpreterState['lastRep']>[];
  readonly activeFrameCount: number;
  readonly trackingLostFrameCount: number;
  readonly metrics: MovementReplayMetrics;
}

export interface RecognitionReplayResult {
  readonly states: readonly MovementRecognitionEngineState[];
  readonly finalState: MovementRecognitionEngineState;
  readonly primaryTimeline: readonly MovementInterpreterState[];
  readonly primaryMovementTypes: readonly MovementInterpreterState['movementType'][];
  readonly metrics: RecognitionReplayMetrics;
}

export interface MovementReplayMetrics {
  readonly activeFrameRatio: number;
  readonly phaseJitter: number;
  readonly confidenceStability: number;
  readonly trackingLostRatio: number;
}

export interface RecognitionReplayMetrics {
  readonly primarySwitchCount: number;
  readonly primaryStability: number;
  readonly confidenceStability: number;
  readonly trackingLostRatio: number;
}

export interface MovementReplayEvaluation {
  readonly repCountAccuracy: number;
  readonly falseActivationCount: number;
  readonly confidenceStability: number;
  readonly phaseJitter: number;
}

export function replayMovementSequence(
  interpreter: MovementInterpreter,
  sequence: PoseSequence,
): MovementReplayResult {
  const states = sequence.map((frame) => interpreter.processPose(frame));

  if (states.length === 0) {
    throw new Error('Cannot replay an empty movement sequence.');
  }

  return summarizeMovementStates(states);
}

export function replayRecognitionSequence(
  engine: { processPose(frame: PoseFrame | undefined): MovementRecognitionEngineState },
  sequence: PoseSequence,
): RecognitionReplayResult {
  const states = sequence.map((frame) => engine.processPose(frame));

  if (states.length === 0) {
    throw new Error('Cannot replay an empty recognition sequence.');
  }

  const primaryTimeline = states.map((state) => state.primary);

  return {
    states,
    finalState: states.at(-1) as MovementRecognitionEngineState,
    primaryTimeline,
    primaryMovementTypes: primaryTimeline.map((state) => state.movementType),
    metrics: summarizeRecognitionMetrics(states, primaryTimeline),
  };
}

export function evaluateMovementReplay(
  replay: MovementReplayResult,
  expected: {
    readonly expectedReps: number;
    readonly allowActiveFrames?: boolean;
  },
): MovementReplayEvaluation {
  const repError = Math.abs(replay.finalState.reps - expected.expectedReps);

  return {
    repCountAccuracy:
      expected.expectedReps === 0
        ? repError === 0
          ? 1
          : 0
        : clamp01(1 - repError / expected.expectedReps),
    falseActivationCount: expected.allowActiveFrames
      ? 0
      : replay.states.filter((state) => state.recognition.status === 'active').length,
    confidenceStability: replay.metrics.confidenceStability,
    phaseJitter: replay.metrics.phaseJitter,
  };
}

export function makePushUpRepSequence(startTimestampMs = 0): PoseSequence {
  return [
    makePushUpFrame({ timestampMs: startTimestampMs, elbowAngle: 166 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 120, elbowAngle: 140 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 260, elbowAngle: 98 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 410, elbowAngle: 132 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 560, elbowAngle: 164 }),
  ];
}

export function makePartialPushUpSequence(startTimestampMs = 0): PoseSequence {
  return [
    makePushUpFrame({ timestampMs: startTimestampMs, elbowAngle: 166 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 130, elbowAngle: 136 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 280, elbowAngle: 164 }),
  ];
}

export function makeInvalidPushUpAlignmentSequence(startTimestampMs = 0): PoseSequence {
  return [
    makePushUpFrame({ timestampMs: startTimestampMs, elbowAngle: 166, hipOffsetY: 0.8 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 140, elbowAngle: 108, hipOffsetY: 0.8 }),
    makePushUpFrame({ timestampMs: startTimestampMs + 300, elbowAngle: 164, hipOffsetY: 0.8 }),
  ];
}

export function makeSquatRepSequence(startTimestampMs = 0): PoseSequence {
  return [
    makeSquatFrame({ timestampMs: startTimestampMs, kneeAngle: 168 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 120, kneeAngle: 138 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 260, kneeAngle: 96 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 410, kneeAngle: 132 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 560, kneeAngle: 166 }),
  ];
}

export function makeForwardLeaningSquatSequence(startTimestampMs = 0): PoseSequence {
  return [
    makeSquatFrame({ timestampMs: startTimestampMs, kneeAngle: 168, torsoLeanX: 0.2 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 120, kneeAngle: 138, torsoLeanX: 0.2 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 260, kneeAngle: 96, torsoLeanX: 0.2 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 410, kneeAngle: 132, torsoLeanX: 0.2 }),
    makeSquatFrame({ timestampMs: startTimestampMs + 560, kneeAngle: 166, torsoLeanX: 0.2 }),
  ];
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

function summarizeMovementStates(
  states: readonly MovementInterpreterState[],
): MovementReplayResult {
  const phaseChanges = states.filter(
    (state, index) => index === 0 || state.phase !== states[index - 1]?.phase,
  );
  const repEvents = states.flatMap((state, index) => {
    if (!state.lastRep) {
      return [];
    }

    const previous = states[index - 1]?.lastRep;

    return previous?.repNumber === state.lastRep.repNumber ? [] : [state.lastRep];
  });

  return {
    states,
    finalState: states.at(-1) as MovementInterpreterState,
    phaseChanges,
    repEvents,
    activeFrameCount: states.filter((state) => state.recognition.status === 'active').length,
    trackingLostFrameCount: states.filter((state) => state.phase === 'tracking_lost').length,
    metrics: summarizeMovementMetrics(states, phaseChanges),
  };
}

function summarizeMovementMetrics(
  states: readonly MovementInterpreterState[],
  phaseChanges: readonly MovementInterpreterState[],
): MovementReplayMetrics {
  return {
    activeFrameRatio:
      states.length === 0
        ? 0
        : states.filter((state) => state.recognition.status === 'active').length / states.length,
    phaseJitter: states.length <= 1 ? 0 : (phaseChanges.length - 1) / (states.length - 1),
    confidenceStability: confidenceStability(states.map((state) => state.recognition.confidence)),
    trackingLostRatio:
      states.length === 0
        ? 0
        : states.filter((state) => state.phase === 'tracking_lost').length / states.length,
  };
}

function summarizeRecognitionMetrics(
  states: readonly MovementRecognitionEngineState[],
  primaryTimeline: readonly MovementInterpreterState[],
): RecognitionReplayMetrics {
  const primarySwitchCount = primaryTimeline.filter(
    (state, index) => index > 0 && state.movementType !== primaryTimeline[index - 1]?.movementType,
  ).length;

  return {
    primarySwitchCount,
    primaryStability:
      primaryTimeline.length <= 1
        ? 1
        : clamp01(1 - primarySwitchCount / (primaryTimeline.length - 1)),
    confidenceStability: confidenceStability(states.map((state) => state.inference.confidence)),
    trackingLostRatio:
      states.length === 0
        ? 0
        : states.filter((state) => state.inference.status === 'tracking_lost').length /
          states.length,
  };
}

function confidenceStability(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return clamp01(1 - Math.sqrt(variance));
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
