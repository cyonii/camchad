import { describe, expect, it } from 'vitest';

import { PushUpDetector } from './push-up-detector.js';
import { makePushUpFrame } from './test-fixtures.js';

describe('PushUpDetector', () => {
  it('counts a complete top-bottom-top push-up once', () => {
    const detector = new PushUpDetector();

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    detector.processPose(makePushUpFrame({ timestampMs: 100, elbowAngle: 130 }));
    detector.processPose(makePushUpFrame({ timestampMs: 220, elbowAngle: 92 }));
    detector.processPose(makePushUpFrame({ timestampMs: 380, elbowAngle: 125 }));
    const state = detector.processPose(makePushUpFrame({ timestampMs: 520, elbowAngle: 165 }));

    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(1);
    expect(state.partialReps).toBe(0);
    expect(state.phase).toBe('top');
    expect(state.lastRep?.depthScore).toBe(1);
  });

  it('records a partial rep when top returns before bottom depth', () => {
    const detector = new PushUpDetector();

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 132 }));
    const state = detector.processPose(makePushUpFrame({ timestampMs: 260, elbowAngle: 164 }));

    expect(state.reps).toBe(1);
    expect(state.validReps).toBe(0);
    expect(state.partialReps).toBe(1);
    expect(state.lastRep?.warnings.some((warning) => warning.code === 'partial_depth')).toBe(true);
  });

  it('does not count while body alignment is invalid', () => {
    const detector = new PushUpDetector();

    detector.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165, hipOffsetY: 0.18 }));
    detector.processPose(makePushUpFrame({ timestampMs: 120, elbowAngle: 94, hipOffsetY: 0.18 }));
    const state = detector.processPose(
      makePushUpFrame({ timestampMs: 260, elbowAngle: 165, hipOffsetY: 0.18 }),
    );

    expect(state.phase).toBe('invalid_form');
    expect(state.reps).toBe(0);
    expect(state.warnings.some((warning) => warning.code === 'body_alignment')).toBe(true);
  });

  it('enters tracking lost state when landmarks are unavailable', () => {
    const detector = new PushUpDetector();

    const state = detector.processPose(undefined);

    expect(state.phase).toBe('tracking_lost');
    expect(state.warnings[0]?.code).toBe('tracking_lost');
  });
});
