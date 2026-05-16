import { describe, expect, it } from 'vitest';

import { enabledPerceptionCapabilities } from './perception-capabilities.js';

describe('perception capability flags', () => {
  it('keeps pose landmarks as the default local perception baseline', () => {
    expect(enabledPerceptionCapabilities()).toEqual(['pose_landmarks', 'pose_world_landmarks']);
  });

  it('adds optional prototype capabilities only when explicitly enabled', () => {
    expect(
      enabledPerceptionCapabilities({
        enablePoseSegmentation: true,
        enableHolisticPrototype: true,
        enableHandLandmarkerPrototype: true,
        enableFaceLandmarkerPrototype: true,
        enablePersonSegmentationPrototype: true,
        enableOnnxRuntimePrototype: true,
      }),
    ).toEqual([
      'pose_landmarks',
      'pose_world_landmarks',
      'pose_segmentation',
      'holistic_landmarks',
      'hand_landmarks',
      'face_landmarks',
      'person_segmentation',
      'onnx_runtime',
    ]);
  });
});
