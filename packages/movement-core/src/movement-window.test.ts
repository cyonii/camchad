import { describe, expect, it } from 'vitest';

import { extractBodyState } from './body-state.js';
import { MovementWindow } from './movement-window.js';
import { makeSquatFrame } from './test-fixtures.js';

describe('MovementWindow', () => {
  it('keeps a rolling time-bounded window of body samples', () => {
    const window = new MovementWindow({ maxAgeMs: 300 });

    window.add(requiredBodyState(0, 168));
    window.add(requiredBodyState(150, 150));
    const snapshot = window.add(requiredBodyState(420, 130));

    expect(snapshot.samples.map((sample) => sample.timestampMs)).toEqual([150, 420]);
    expect(snapshot.durationMs).toBe(270);
    expect(snapshot.validSamples).toHaveLength(2);
  });

  it('also respects the configured sample count cap', () => {
    const window = new MovementWindow({ maxAgeMs: 1000, maxSamples: 2 });

    window.add(requiredBodyState(0, 168));
    window.add(requiredBodyState(100, 150));
    const snapshot = window.add(requiredBodyState(200, 132));

    expect(snapshot.samples.map((sample) => sample.timestampMs)).toEqual([100, 200]);
  });

  it('tracks confidence history and explicit missing samples', () => {
    const window = new MovementWindow({ maxAgeMs: 1000 });

    window.add(requiredBodyState(0, 168, 0.9));
    window.addMissing(120);
    const snapshot = window.add(requiredBodyState(240, 148, 0.7));

    expect(snapshot.validSamples).toHaveLength(2);
    expect(snapshot.missingSampleCount).toBe(1);
    expect(snapshot.missingSampleRatio).toBeCloseTo(1 / 3);
    expect(snapshot.averageConfidence).toBeCloseTo(0.8);
  });

  it('summarizes body scale, center, and landmark stability across the window', () => {
    const stableWindow = new MovementWindow({ maxAgeMs: 1000 });

    stableWindow.add(requiredBodyState(0, 168));
    const stableSnapshot = stableWindow.add(requiredBodyState(120, 166));

    const unstableWindow = new MovementWindow({ maxAgeMs: 1000 });

    unstableWindow.add(requiredBodyState(0, 168));
    const unstableSnapshot = unstableWindow.add(
      requiredBodyState(120, 166, 0.95, {
        scale: 1.7,
        offsetX: 0.08,
        offsetY: 0.04,
        leftWristJitterY: 0.24,
      }),
    );

    expect(stableSnapshot.environment.scaleStability).toBeGreaterThan(
      unstableSnapshot.environment.scaleStability,
    );
    expect(stableSnapshot.environment.centerStability).toBeGreaterThan(
      unstableSnapshot.environment.centerStability,
    );
    expect(unstableSnapshot.environment.landmarkJitter).toBeGreaterThan(0.05);
  });

  it('calculates signal velocity and direction across valid samples', () => {
    const window = new MovementWindow({ maxAgeMs: 1000 });

    window.add(requiredBodyState(0, 168));
    window.addMissing(100);
    window.add(requiredBodyState(250, 118));

    const velocity = window.signalVelocity((bodyState) => bodyState.jointAngles.leftKnee);

    expect(velocity?.valuePerSecond).toBeCloseTo(-200);
    expect(velocity?.direction).toBe('decreasing');
    expect(velocity?.fromTimestampMs).toBe(0);
    expect(velocity?.toTimestampMs).toBe(250);
  });

  it('returns no velocity until two valid signal samples exist', () => {
    const window = new MovementWindow({ maxAgeMs: 1000 });

    window.addMissing(0);
    window.add(requiredBodyState(120, 168));

    expect(window.signalVelocity((bodyState) => bodyState.jointAngles.leftKnee)).toBeUndefined();
  });

  it('summarizes signal range across valid samples', () => {
    const window = new MovementWindow({ maxAgeMs: 1000 });

    window.add(requiredBodyState(0, 168));
    window.addMissing(100);
    window.add(requiredBodyState(250, 118));
    window.add(requiredBodyState(500, 140));

    const stats = window.signalStats((bodyState) => bodyState.jointAngles.leftKnee);

    expect(stats.min).toBeCloseTo(118);
    expect(stats.max).toBeCloseTo(168);
    expect(stats.average).toBeCloseTo(142);
    expect(stats.range).toBeCloseTo(50);
    expect(stats.sampleCount).toBe(3);
  });

  it('detects oscillating rhythm across a repeated signal', () => {
    const window = new MovementWindow({ maxAgeMs: 2000 });

    window.add(requiredBodyState(0, 168));
    window.add(requiredBodyState(200, 118));
    window.add(requiredBodyState(400, 168));
    window.add(requiredBodyState(600, 118));
    window.add(requiredBodyState(800, 168));

    const rhythm = window.signalRhythm((bodyState) => bodyState.jointAngles.leftKnee);

    expect(rhythm.cycleCount).toBe(1);
    expect(rhythm.amplitude).toBeCloseTo(50);
    expect(rhythm.averageCycleMs).toBeCloseTo(400);
    expect(rhythm.rhythmScore).toBeGreaterThan(0);
  });

  it('rejects invalid configuration early', () => {
    expect(() => new MovementWindow({ maxAgeMs: 0 })).toThrow(/maxAgeMs/);
  });
});

function requiredBodyState(
  timestampMs: number,
  kneeAngle: number,
  visibility = 0.95,
  transform: {
    readonly scale?: number;
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly leftWristJitterY?: number;
  } = {},
) {
  const frame = makeSquatFrame({ timestampMs, kneeAngle, visibility });
  const bodyState = extractBodyState(
    transform.scale || transform.offsetX || transform.offsetY || transform.leftWristJitterY
      ? {
          ...frame,
          landmarks: new Map(
            [...frame.landmarks.entries()].map(([name, landmark]) => [
              name,
              {
                ...landmark,
                x: 0.5 + (landmark.x - 0.5) * (transform.scale ?? 1) + (transform.offsetX ?? 0),
                y:
                  0.5 +
                  (landmark.y - 0.5) * (transform.scale ?? 1) +
                  (transform.offsetY ?? 0) +
                  (name === 'left_wrist' ? (transform.leftWristJitterY ?? 0) : 0),
              },
            ]),
          ),
        }
      : frame,
  );

  if (!bodyState) {
    throw new Error('Expected fixture to produce a body state.');
  }

  return bodyState;
}
