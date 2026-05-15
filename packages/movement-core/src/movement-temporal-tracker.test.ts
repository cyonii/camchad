import { describe, expect, it } from 'vitest';

import { extractBodyState } from './body-state.js';
import { MovementTemporalTracker } from './movement-temporal-tracker.js';
import { makeSquatFrame } from './test-fixtures.js';

describe('MovementTemporalTracker', () => {
  it('coordinates body windows and confidence accumulation', () => {
    const tracker = makeTracker();
    const first = requiredBodyState(0, 168);
    const second = requiredBodyState(120, 138);

    tracker.add(first, 0.9);
    const snapshot = tracker.add(second, 0.9);

    expect(snapshot.window.durationMs).toBe(120);
    expect(snapshot.window.validSamples).toHaveLength(2);
    expect(snapshot.confidence.state).toBe('active');
    expect(snapshot.confidence.confidence).toBeGreaterThan(0.7);
  });

  it('records explicit missing samples between valid body states', () => {
    const tracker = makeTracker();

    tracker.add(requiredBodyState(0, 168), 0.9);
    tracker.addMissing(80);
    const snapshot = tracker.add(requiredBodyState(160, 138), 0.9);

    expect(snapshot.window.missingSampleCount).toBe(1);
    expect(snapshot.window.missingSampleRatio).toBeCloseTo(1 / 3);
  });

  it('uses deterministic synthetic timestamps when missing samples have no frame time', () => {
    const tracker = makeTracker();

    tracker.add(requiredBodyState(100, 168), 0.9);
    const snapshot = tracker.addMissing();

    expect(snapshot.window.latest?.timestampMs).toBe(116);
  });

  it('exposes window signal velocity', () => {
    const tracker = makeTracker();

    tracker.add(requiredBodyState(0, 168), 0.9);
    tracker.add(requiredBodyState(120, 138), 0.9);

    const velocity = tracker.signalVelocity((state) => state.jointAngles.leftKnee);

    expect(velocity?.direction).toBe('decreasing');
    expect(velocity?.valuePerSecond).toBeLessThan(0);
  });
});

function makeTracker() {
  return new MovementTemporalTracker({
    windowMaxAgeMs: 1000,
    confidence: {
      activationThreshold: 0.7,
      deactivationThreshold: 0.42,
      candidateThreshold: 0.48,
      riseAlpha: 0.6,
      fallAlpha: 0.45,
    },
  });
}

function requiredBodyState(timestampMs: number, kneeAngle: number) {
  const bodyState = extractBodyState(makeSquatFrame({ timestampMs, kneeAngle }));

  if (!bodyState) {
    throw new Error('Expected fixture to produce a body state.');
  }

  return bodyState;
}
