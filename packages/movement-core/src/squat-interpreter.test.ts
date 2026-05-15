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

  it('reports temporal movement telemetry while interpreting squats', () => {
    const interpreter = new SquatMovementInterpreter();

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    const state = interpreter.processPose(makeSquatFrame({ timestampMs: 120, kneeAngle: 138 }));

    expect(state.metrics.temporalMovementConfidence).toBeGreaterThan(0.7);
    expect(state.metrics.sampleWindowMs).toBe(120);
    expect(state.metrics.missingSampleRatio).toBe(0);
    expect(state.metrics.primaryJointVelocity).toBeLessThan(0);
    expect(state.metrics.temporalStabilityScore).toBeGreaterThan(0.7);
  });

  it('does not enter a rep phase for slow standing threshold drift', () => {
    const interpreter = new SquatMovementInterpreter();

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    const state = interpreter.processPose(makeSquatFrame({ timestampMs: 6000, kneeAngle: 152 }));

    expect(state.phase).toBe('top');
    expect(state.reps).toBe(0);
    expect(Math.abs(state.metrics.phaseVelocity ?? 0)).toBeLessThan(12);
  });
});
