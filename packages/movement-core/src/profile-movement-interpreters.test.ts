import {
  toLandmarkMap,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';
import { describe, expect, it } from 'vitest';

import { createMovementInterpreterForDefinition } from './movement-definition-interpreter.js';
import { movementRegistry } from './movement-registry.js';
import { createProfileMovementInterpreter } from './profile-movement-interpreters.js';
import { makePlankFrame } from './test-fixtures.js';

describe('profile movement interpreters', () => {
  it('creates interpreters for every active movement definition through the shared factory', () => {
    expect(
      movementRegistry
        .filter((definition) => definition.maturity !== 'planned')
        .every((definition) => createMovementInterpreterForDefinition(definition) !== undefined),
    ).toBe(true);
    expect(
      movementRegistry
        .filter((definition) => definition.maturity === 'planned')
        .every((definition) => createMovementInterpreterForDefinition(definition) === undefined),
    ).toBe(true);
    expect(
      movementRegistry.filter((definition) => definition.maturity === 'rep_validating'),
    ).toHaveLength(2);
    expect(
      movementRegistry.filter((definition) => definition.maturity === 'rep_counting'),
    ).toHaveLength(10);
    expect(
      movementRegistry.filter((definition) => definition.maturity === 'planned').length,
    ).toBeGreaterThan(0);
  });

  it('counts a high-knees cycle from knee lift rhythm', () => {
    const interpreter = createProfileMovementInterpreter('high_knees');

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
    const interpreter = createProfileMovementInterpreter('plank');

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
      ...standingSide('right', 0.51, 0.66),
    ]),
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
