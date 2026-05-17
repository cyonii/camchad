import { describe, expect, it } from 'vitest';

import { createRepValidatingMovementInterpreter } from './rep-validating-movement-interpreter.js';
import { makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('rep-validating movement interpreter', () => {
  it('counts a complete top-bottom-top push-up once', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    detector.processPose(makePushUpFrame({ timestampMs: 100, elbowAngle: 130 }));
    detector.processPose(makePushUpFrame({ timestampMs: 220, elbowAngle: 92 }));
    detector.processPose(makePushUpFrame({ timestampMs: 380, elbowAngle: 125 }));
    const state = detector.processPose(makePushUpFrame({ timestampMs: 520, elbowAngle: 165 }));

    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(1);
    expect(state.partialReps).toBe(0);
    expect(state.phase).toBe('top');
    expect(state.stateKind).toBe('setup');
    expect(state.lastRep?.depthScore).toBe(1);
  });

  it('recognizes push-up movement before validating a complete rep', () => {
    const interpreter = createRepValidatingMovementInterpreter('push_up');

    interpreter.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    const state = interpreter.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 132 }));

    expect(state.recognition).toMatchObject({
      movementType: 'push_up',
      status: 'active',
    });
    expect(state.recognition.confidence).toBeGreaterThan(0.8);
    expect(state.reps).toBe(0);
  });

  it('counts from the visible side when the far side is obscured', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(
      makePushUpFrame({ timestampMs: 0, elbowAngle: 158, rightVisibility: 0.1 }),
    );
    detector.processPose(
      makePushUpFrame({ timestampMs: 100, elbowAngle: 135, rightVisibility: 0.1 }),
    );
    detector.processPose(
      makePushUpFrame({ timestampMs: 200, elbowAngle: 116, rightVisibility: 0.1 }),
    );
    detector.processPose(
      makePushUpFrame({ timestampMs: 340, elbowAngle: 135, rightVisibility: 0.1 }),
    );
    const state = detector.processPose(
      makePushUpFrame({ timestampMs: 460, elbowAngle: 154, rightVisibility: 0.1 }),
    );

    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(1);
    expect(state.metrics.poseConfidence).toBeCloseTo(0.95);
    expect(state.metrics.primaryJointAngle).toBeCloseTo(154);
    expect(state.metrics.rangeOfMotionScore).toBeGreaterThan(0);
    expect(state.metrics.trackingSide).toBe(0);
  });

  it('records a partial rep when top returns before bottom depth', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 130 }));
    const state = detector.processPose(makePushUpFrame({ timestampMs: 260, elbowAngle: 164 }));

    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(0);
    expect(state.partialReps).toBe(1);
    expect(state.stateKind).toBe('partial_rep');
    expect(state.lastRep?.warnings.some((warning) => warning.code === 'partial_depth')).toBe(true);
  });

  it('warns on mild body alignment drift without blocking the rep', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165, hipOffsetY: 0.34 }));
    detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 94, hipOffsetY: 0.34 }));
    const state = detector.processPose(
      makePushUpFrame({ timestampMs: 260, elbowAngle: 165, hipOffsetY: 0.34 }),
    );

    expect(state.reps).toBe(1);
    expect(state.warnings.some((warning) => warning.code === 'body_alignment')).toBe(true);
  });

  it('does not count while body alignment is severely invalid', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165, hipOffsetY: 0.8 }));
    detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 110, hipOffsetY: 0.8 }));
    const state = detector.processPose(
      makePushUpFrame({ timestampMs: 260, elbowAngle: 165, hipOffsetY: 0.8 }),
    );

    expect(state.phase).toBe('invalid_form');
    expect(state.stateKind).toBe('failed_rep');
    expect(state.reps).toBe(0);
  });

  it('enters tracking lost state when landmarks are unavailable', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    const state = detector.processPose(undefined);

    expect(state.phase).toBe('tracking_lost');
    expect(state.stateKind).toBe('tracking_lost');
    expect(state.recognition.status).toBe('tracking_lost');
    expect(state.warnings[0]?.code).toBe('tracking_lost');
  });

  it('reports temporal movement telemetry while interpreting push-ups', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    const state = detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 132 }));

    expect(state.metrics.temporalMovementConfidence).toBeGreaterThan(0.7);
    expect(state.metrics.sampleWindowMs).toBe(120);
    expect(state.metrics.missingSampleRatio).toBe(0);
    expect(state.metrics.primaryJointVelocity).toBeLessThan(0);
    expect(state.metrics.primaryJointRange).toBeGreaterThan(30);
    expect(state.metrics.rhythmScore).toBeGreaterThanOrEqual(0);
    expect(state.metrics.tempoDriftRatio).toBeGreaterThanOrEqual(0);
    expect(state.metrics.tempoDriftMs).toBeGreaterThanOrEqual(0);
    expect(state.metrics.lockoutScore).toBeGreaterThan(0);
    expect(state.metrics.depthDeficitDegrees).toBeGreaterThan(0);
    expect(state.metrics.depthDriftDegrees).toBeGreaterThan(0);
    expect(state.metrics.alignmentDegradation).toBeGreaterThanOrEqual(0);
    expect(state.metrics.confidenceDecay).toBe(0);
    expect(state.metrics.bottomHoldMs).toBe(0);
    expect(state.metrics.fatigueScore).toBeGreaterThanOrEqual(0);
    expect(state.metrics.handStackScore).toBeGreaterThan(0);
    expect(state.metrics.shoulderTravelRatio).toBe(0);
    expect(state.metrics.temporalStabilityScore).toBeGreaterThan(0.8);
  });

  it('surfaces fatigue telemetry from confidence and bottom-hold behavior', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165, visibility: 0.95 }));
    detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 132, visibility: 0.85 }));
    detector.processPose(makePushUpFrame({ timestampMs: 260, elbowAngle: 96, visibility: 0.75 }));
    detector.processPose(makePushUpFrame({ timestampMs: 420, elbowAngle: 132, visibility: 0.7 }));
    const state = detector.processPose(
      makePushUpFrame({ timestampMs: 560, elbowAngle: 165, visibility: 0.7 }),
    );

    expect(state.validReps).toBe(1);
    expect(state.metrics.confidenceDecay).toBeGreaterThan(0);
    expect(state.metrics.bottomHoldMs).toBeGreaterThanOrEqual(80);
    expect(state.metrics.fatigueScore).toBeGreaterThan(0);
  });

  it('does not enter a rep phase for slow top-position threshold drift', () => {
    const detector = createRepValidatingMovementInterpreter('push_up');

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    const state = detector.processPose(makePushUpFrame({ timestampMs: 6000, elbowAngle: 146 }));

    expect(state.phase).toBe('top');
    expect(state.reps).toBe(0);
    expect(Math.abs(state.metrics.phaseVelocity ?? 0)).toBeLessThan(12);
  });
});

describe('rep-validating standing knee-bend profile', () => {
  it('counts a complete standing-bottom-standing squat once', () => {
    const interpreter = createRepValidatingMovementInterpreter('squat');

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    interpreter.processPose(makeSquatFrame({ timestampMs: 120, kneeAngle: 138 }));
    interpreter.processPose(makeSquatFrame({ timestampMs: 260, kneeAngle: 96 }));
    interpreter.processPose(makeSquatFrame({ timestampMs: 390, kneeAngle: 132 }));
    const state = interpreter.processPose(makeSquatFrame({ timestampMs: 540, kneeAngle: 166 }));

    expect(state.movementType).toBe('squat');
    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(1);
    expect(state.stateKind).toBe('setup');
    expect(state.recognition).toMatchObject({
      movementType: 'squat',
      status: 'active',
    });
  });

  it('does not classify floor-oriented push-up motion as a squat', () => {
    const interpreter = createRepValidatingMovementInterpreter('squat');

    const state = interpreter.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }));

    expect(state.recognition).toMatchObject({
      confidence: 0.12,
      status: 'candidate',
    });
    expect(state.reps).toBe(0);
  });

  it('reports temporal movement telemetry while interpreting squats', () => {
    const interpreter = createRepValidatingMovementInterpreter('squat');

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    const state = interpreter.processPose(makeSquatFrame({ timestampMs: 120, kneeAngle: 138 }));

    expect(state.metrics.temporalMovementConfidence).toBeGreaterThan(0.7);
    expect(state.metrics.sampleWindowMs).toBe(120);
    expect(state.metrics.missingSampleRatio).toBe(0);
    expect(state.metrics.primaryJointVelocity).toBeLessThan(0);
    expect(state.metrics.primaryJointRange).toBeGreaterThan(20);
    expect(state.metrics.rhythmScore).toBeGreaterThanOrEqual(0);
    expect(state.metrics.tempoDriftRatio).toBeGreaterThanOrEqual(0);
    expect(state.metrics.tempoDriftMs).toBeGreaterThanOrEqual(0);
    expect(state.metrics.depthDeficitDegrees).toBeGreaterThan(0);
    expect(state.metrics.depthConsistencyScore).toBeGreaterThanOrEqual(0);
    expect(state.metrics.standingRecoveryScore).toBeGreaterThan(0);
    expect(state.metrics.torsoCollapseRatio).toBeGreaterThanOrEqual(0);
    expect(state.metrics.leftRightImbalance).toBeGreaterThanOrEqual(0);
    expect(state.metrics.confidenceDecay).toBe(0);
    expect(state.metrics.bottomHoldMs).toBe(0);
    expect(state.metrics.fatigueScore).toBeGreaterThanOrEqual(0);
    expect(state.metrics.torsoInclinationRange).toBeGreaterThanOrEqual(0);
    expect(state.metrics.centerOfMassTravelRatio).toBeGreaterThanOrEqual(0);
    expect(state.metrics.lowerBodyCoverage).toBeGreaterThan(0.6);
    expect(state.metrics.temporalStabilityScore).toBeGreaterThan(0.7);
  });

  it('surfaces fatigue telemetry from confidence, posture, and bottom-hold behavior', () => {
    const interpreter = createRepValidatingMovementInterpreter('squat');

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168, visibility: 0.95 }));
    interpreter.processPose(
      makeSquatFrame({ timestampMs: 120, kneeAngle: 138, visibility: 0.86, torsoLeanX: 0.05 }),
    );
    interpreter.processPose(
      makeSquatFrame({ timestampMs: 260, kneeAngle: 96, visibility: 0.75, torsoLeanX: 0.1 }),
    );
    interpreter.processPose(
      makeSquatFrame({ timestampMs: 430, kneeAngle: 132, visibility: 0.7, torsoLeanX: 0.1 }),
    );
    const state = interpreter.processPose(
      makeSquatFrame({ timestampMs: 580, kneeAngle: 166, visibility: 0.7, torsoLeanX: 0.08 }),
    );

    expect(state.validReps).toBe(1);
    expect(state.metrics.confidenceDecay).toBeGreaterThan(0);
    expect(state.metrics.torsoCollapseRatio).toBeGreaterThan(0);
    expect(state.metrics.bottomHoldMs).toBeGreaterThanOrEqual(80);
    expect(state.metrics.fatigueScore).toBeGreaterThan(0);
  });

  it('does not enter a rep phase for slow standing threshold drift', () => {
    const interpreter = createRepValidatingMovementInterpreter('squat');

    interpreter.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    const state = interpreter.processPose(makeSquatFrame({ timestampMs: 6000, kneeAngle: 152 }));

    expect(state.phase).toBe('top');
    expect(state.reps).toBe(0);
    expect(Math.abs(state.metrics.phaseVelocity ?? 0)).toBeLessThan(12);
  });
});
