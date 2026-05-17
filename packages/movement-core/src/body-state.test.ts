import { describe, expect, it } from 'vitest';

import { toLandmarkMap, type PoseFrame, type PoseLandmark } from '@camchad/pose-core';

import { extractBodyState } from './body-state.js';
import { makeHighKneesSequence, makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('extractBodyState', () => {
  it('normalizes standing body landmarks around the torso center', () => {
    const state = extractBodyState(makeSquatFrame({ timestampMs: 120, kneeAngle: 140 }));

    expect(state).toBeDefined();
    expect(state?.orientation.kind).toBe('standing');
    expect(state?.viewOrientation.kind).toBe('side');
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

  it('preserves normalized world landmarks when estimator depth data is available', () => {
    const frame = makeSquatFrame({ timestampMs: 120, kneeAngle: 140 });
    const state = extractBodyState({
      ...frame,
      worldLandmarks: toLandmarkMap(
        [...frame.landmarks.values()].map((landmark) => ({
          ...landmark,
          x: landmark.x - 0.5,
          y: landmark.y - 0.5,
          z: (landmark.z ?? 0) + 0.1,
        })),
      ),
    });

    expect(state?.worldLandmarks?.get('left_knee')?.normalizedY).toBeGreaterThan(0);
    expect(state?.worldLandmarks?.get('left_knee')?.normalizedZ).toBeDefined();
  });

  it('classifies broad shoulder and hip spans as front-facing camera orientation', () => {
    const state = extractBodyState(widenTorso(makeSquatFrame({ timestampMs: 0, kneeAngle: 160 })));

    expect(state?.viewOrientation.kind).toBe('front');
    expect(state?.viewOrientation.confidence).toBeGreaterThan(0);
  });

  it('classifies seated and hanging body orientations when posture signals are clear', () => {
    expect(
      extractBodyState(seatLegs(makeSquatFrame({ timestampMs: 0, kneeAngle: 160 })))?.orientation
        .kind,
    ).toBe('seated');
    expect(
      extractBodyState(raiseWrists(makeSquatFrame({ timestampMs: 0, kneeAngle: 160 })))?.orientation
        .kind,
    ).toBe('hanging');
  });

  it('does not classify one lifted knee as seated posture', () => {
    const firstFrame = makeHighKneesSequence(0)[0];

    expect(extractBodyState(firstFrame)?.orientation.kind).toBe('standing');
  });

  it('reports region coverage separately for visible and occluded sides', () => {
    const state = extractBodyState(
      makePushUpFrame({ timestampMs: 0, elbowAngle: 150, rightVisibility: 0.1 }),
    );

    expect(state?.coverage.regions.leftArm).toBeGreaterThan(0.9);
    expect(state?.coverage.regions.rightArm).toBeLessThan(0.2);
    expect(state?.environment.lowConfidenceRegions).toContain('rightArm');
    expect(state?.environment.occlusionRisk).toBeGreaterThan(0);
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

function widenTorso(frame: PoseFrame): PoseFrame {
  return {
    ...frame,
    landmarks: toLandmarkMap(
      [...frame.landmarks.values()].map((landmark) => {
        switch (landmark.name) {
          case 'left_shoulder':
          case 'left_hip':
            return { ...landmark, x: 0.34 };
          case 'right_shoulder':
          case 'right_hip':
            return { ...landmark, x: 0.66 };
          default:
            return landmark;
        }
      }),
    ),
  };
}

function seatLegs(frame: PoseFrame): PoseFrame {
  return mapLandmarks(frame, (landmark) => {
    switch (landmark.name) {
      case 'left_knee':
      case 'right_knee':
        return { ...landmark, y: 0.49 };
      default:
        return landmark;
    }
  });
}

function raiseWrists(frame: PoseFrame): PoseFrame {
  return mapLandmarks(frame, (landmark) => {
    switch (landmark.name) {
      case 'left_wrist':
      case 'right_wrist':
        return { ...landmark, y: 0.04 };
      default:
        return landmark;
    }
  });
}

function mapLandmarks(
  frame: PoseFrame,
  mapper: (landmark: PoseLandmark) => PoseLandmark,
): PoseFrame {
  return {
    ...frame,
    landmarks: toLandmarkMap([...frame.landmarks.values()].map(mapper)),
  };
}
