import { describe, expect, it } from 'vitest';

import { poseModelAssetPath, poseModelProfileFor, poseModelProfiles } from './pose-models.js';

describe('pose model profiles', () => {
  it('defines lite, full, and heavy model profiles for local benchmarking', () => {
    expect(Object.keys(poseModelProfiles)).toEqual(['lite', 'full', 'heavy']);
    expect(poseModelProfileFor('lite')).toMatchObject({
      modelFilename: 'pose_landmarker_lite.task',
      expectedRuntimeCost: 'low',
    });
    expect(poseModelProfileFor('full')).toMatchObject({
      modelFilename: 'pose_landmarker_full.task',
      expectedRuntimeCost: 'medium',
    });
    expect(poseModelProfileFor('heavy')).toMatchObject({
      modelFilename: 'pose_landmarker_heavy.task',
      expectedRuntimeCost: 'high',
    });
  });

  it('builds stable asset paths regardless of trailing slashes', () => {
    expect(poseModelAssetPath('/vendor/mediapipe', 'full')).toBe(
      '/vendor/mediapipe/pose_landmarker_full.task',
    );
    expect(poseModelAssetPath('/vendor/mediapipe/', 'heavy')).toBe(
      '/vendor/mediapipe/pose_landmarker_heavy.task',
    );
  });
});
