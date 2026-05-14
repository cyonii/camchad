import { describe, expect, it } from 'vitest';

import { toLandmarkMap, type PoseFrame } from '@camchad/pose-core';

import { extractBodyState } from './body-state.js';
import { makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('extractBodyState', () => {
  it('normalizes standing body landmarks around the torso center', () => {
    const state = extractBodyState(makeSquatFrame({ timestampMs: 120, kneeAngle: 140 }));

    expect(state).toBeDefined();
    expect(state?.orientation.kind).toBe('standing');
    expect(state?.orientation.confidence).toBeGreaterThan(0.8);
    expect(state?.scale).toBeGreaterThan(0);
    expect(state?.landmarks.get('left_knee')?.normalizedY).toBeGreaterThan(0);
    expect(state?.jointAngles.leftKnee).toBeCloseTo(140);
  });

  it('classifies floor-oriented body state from push-up geometry', () => {
    const state = extractBodyState(makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }));

    expect(state?.orientation.kind).toBe('floor');
    expect(state?.jointAngles.leftElbow).toBeCloseTo(150);
    expect(state?.geometry.torsoInclinationDegrees).toBeGreaterThan(80);
  });

  it('reports region coverage separately for visible and occluded sides', () => {
    const state = extractBodyState(
      makePushUpFrame({ timestampMs: 0, elbowAngle: 150, rightVisibility: 0.1 }),
    );

    expect(state?.coverage.regions.leftArm).toBeGreaterThan(0.9);
    expect(state?.coverage.regions.rightArm).toBeLessThan(0.2);
    expect(state?.coverage.upperBody).toBeLessThan(0.75);
  });

  it('returns undefined when torso anchors are unavailable', () => {
    const frame: PoseFrame = {
      timestampMs: 0,
      landmarks: toLandmarkMap([]),
      confidence: 0,
    };

    expect(extractBodyState(frame)).toBeUndefined();
    expect(extractBodyState(undefined)).toBeUndefined();
  });
});
