import { describe, expect, it } from 'vitest';

import type { MovementInterpreter, MovementInterpreterState } from './movement-interpreter.js';
import {
  createMovementRecognitionEngine,
  MovementRecognitionEngine,
} from './movement-recognition-engine.js';
import { makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('MovementRecognitionEngine', () => {
  it('selects the strongest recognized movement as the primary state', () => {
    const engine = new MovementRecognitionEngine([
      fakeInterpreter(
        movementState({
          recognition: {
            movementType: 'push_up',
            confidence: 0.9,
            status: 'tracking_lost',
            evidence: [],
          },
        }),
      ),
      fakeInterpreter(
        movementState({
          recognition: {
            movementType: 'push_up',
            confidence: 0.62,
            status: 'active',
            evidence: ['test'],
          },
          validReps: 2,
        }),
      ),
    ]);

    expect(engine.getState().primary).toMatchObject({
      recognition: {
        status: 'active',
      },
      validReps: 2,
    });
  });

  it('resets every interpreter owned by the engine', () => {
    const interpreters = [fakeInterpreter(movementState()), fakeInterpreter(movementState())];
    const engine = new MovementRecognitionEngine(interpreters);

    engine.reset();

    expect(interpreters.every((interpreter) => interpreter.resetCount === 1)).toBe(true);
  });

  it('distinguishes standing squat motion from floor push-up motion', () => {
    const engine = createMovementRecognitionEngine();

    engine.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    engine.processPose(makeSquatFrame({ timestampMs: 120, kneeAngle: 138 }));
    engine.processPose(makeSquatFrame({ timestampMs: 260, kneeAngle: 96 }));
    const squatState = engine.processPose(
      makeSquatFrame({ timestampMs: 420, kneeAngle: 166 }),
    ).primary;

    engine.reset();
    engine.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    const pushUpState = engine.processPose(
      makePushUpFrame({ timestampMs: 140, elbowAngle: 132 }),
    ).primary;

    expect(squatState.movementType).toBe('squat');
    expect(pushUpState.movementType).toBe('push_up');
  });
});

function fakeInterpreter(
  state: MovementInterpreterState,
): MovementInterpreter & { resetCount: number } {
  return {
    movementType: 'push_up',
    resetCount: 0,
    processPose: () => state,
    getState: () => state,
    reset() {
      this.resetCount += 1;
    },
  };
}

function movementState(
  overrides: Partial<MovementInterpreterState> = {},
): MovementInterpreterState {
  return {
    movementType: 'push_up',
    recognition: {
      movementType: 'push_up',
      confidence: 0,
      status: 'tracking_lost',
      evidence: [],
    },
    phase: 'setup_needed',
    reps: 0,
    validReps: 0,
    partialReps: 0,
    warnings: [],
    metrics: {},
    ...overrides,
  };
}
