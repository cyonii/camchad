import { describe, expect, it } from 'vitest';

import type { MovementInterpreter, MovementInterpreterState } from './movement-interpreter.js';
import { MovementRecognitionEngine } from './movement-recognition-engine.js';

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
