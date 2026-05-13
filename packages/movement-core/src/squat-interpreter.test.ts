import { describe, expect, it } from 'vitest';

import { SquatMovementInterpreter } from './squat-interpreter.js';
import { makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('SquatMovementInterpreter', () => {
  it('counts a complete standing-bottom-standing squat once', () => {
    const interpreter = new SquatMovementInterpreter();

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    interpreter.processPose(makeSquatFrame({ timestampMs: 120, kneeAngle: 138 }));
    interpreter.processPose(makeSquatFrame({ timestampMs: 260, kneeAngle: 96 }));
    interpreter.processPose(makeSquatFrame({ timestampMs: 390, kneeAngle: 132 }));
    const state = interpreter.processPose(makeSquatFrame({ timestampMs: 540, kneeAngle: 166 }));

    expect(state.movementType).toBe('squat');
    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(1);
    expect(state.recognition).toMatchObject({
      movementType: 'squat',
      status: 'active',
    });
  });

  it('does not classify floor-oriented push-up motion as a squat', () => {
    const interpreter = new SquatMovementInterpreter();

    const state = interpreter.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }));

    expect(state.recognition).toMatchObject({
      confidence: 0.12,
      status: 'candidate',
    });
    expect(state.reps).toBe(0);
  });
});
