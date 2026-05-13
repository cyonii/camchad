import {
  toLandmarkMap,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';
import { describe, expect, it } from 'vitest';

import { movementRegistry } from './movement-registry.js';
import { createRecognitionMovementInterpreter } from './recognition-movement-interpreters.js';

describe('recognition movement interpreters', () => {
  it('creates an interpreter for every catalog movement', () => {
    expect(movementRegistry.every((definition) => definition.createInterpreter)).toBe(true);
    expect(
      movementRegistry.filter((definition) => definition.supportLevel === 'validation'),
    ).toHaveLength(2);
    expect(
      movementRegistry.filter((definition) => definition.supportLevel === 'recognition'),
    ).toHaveLength(10);
  });

  it('counts a high-knees cycle from knee lift rhythm', () => {
    const interpreter = createRecognitionMovementInterpreter('high_knees');

    interpreter.processPose(makeStandingKneeLiftFrame({ timestampMs: 0, kneeY: 0.66 }));
    interpreter.processPose(makeStandingKneeLiftFrame({ timestampMs: 100, kneeY: 0.5 }));
    interpreter.processPose(makeStandingKneeLiftFrame({ timestampMs: 220, kneeY: 0.33 }));
    interpreter.processPose(makeStandingKneeLiftFrame({ timestampMs: 340, kneeY: 0.5 }));
    const state = interpreter.processPose(
      makeStandingKneeLiftFrame({ timestampMs: 460, kneeY: 0.66 }),
    );

    expect(state).toMatchObject({
      movementType: 'high_knees',
      reps: 1,
      validReps: 1,
      recognition: {
        movementType: 'high_knees',
        status: 'active',
      },
    });
  });

  it('promotes a stable plank hold only after the hold window is satisfied', () => {
    const interpreter = createRecognitionMovementInterpreter('plank');

    const earlyState = interpreter.processPose(makePlankFrame(0));
    const heldState = interpreter.processPose(makePlankFrame(1300));

    expect(earlyState.recognition.status).toBe('candidate');
    expect(heldState).toMatchObject({
      movementType: 'plank',
      reps: 1,
      validReps: 1,
      recognition: {
        movementType: 'plank',
        status: 'active',
      },
    });
  });
});

function makeStandingKneeLiftFrame({
  timestampMs,
  kneeY,
}: {
  readonly timestampMs: number;
  readonly kneeY: number;
}): PoseFrame {
  return {
    timestampMs,
    confidence: 0.95,
    landmarks: toLandmarkMap([
      ...standingSide('left', 0.49, kneeY),
      ...standingSide('right', 0.51, kneeY),
    ]),
  };
}

function makePlankFrame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    confidence: 0.95,
    landmarks: toLandmarkMap([...floorSide('left', 0.49), ...floorSide('right', 0.51)]),
  };
}

function standingSide(side: 'left' | 'right', x: number, kneeY: number): readonly PoseLandmark[] {
  return [
    landmark(`${side}_shoulder`, x, 0.2),
    landmark(`${side}_elbow`, x, 0.34),
    landmark(`${side}_wrist`, x, 0.5),
    landmark(`${side}_hip`, x, 0.45),
    landmark(`${side}_knee`, x, kneeY),
    landmark(`${side}_ankle`, x, 0.86),
  ];
}

function floorSide(side: 'left' | 'right', y: number): readonly PoseLandmark[] {
  return [
    landmark(`${side}_shoulder`, 0.24, y),
    landmark(`${side}_elbow`, 0.18, y),
    landmark(`${side}_wrist`, 0.12, y),
    landmark(`${side}_hip`, 0.5, y),
    landmark(`${side}_knee`, 0.66, y),
    landmark(`${side}_ankle`, 0.82, y),
  ];
}

function landmark(name: string, x: number, y: number): PoseLandmark {
  return {
    name: name as LandmarkName,
    x,
    y,
    z: 0,
    visibility: 0.95,
    presence: 0.95,
  };
}
