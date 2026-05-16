import { describe, expect, it } from 'vitest';

import { evaluatePerceptionCapabilities } from './perception-evaluation.js';

describe('perception capability evaluation', () => {
  it('keeps pose landmarks as the baseline and optional models disabled by default', () => {
    const evaluations = evaluatePerceptionCapabilities();

    expect(evaluations.find((entry) => entry.capability === 'pose_landmarks')).toMatchObject({
      status: 'baseline',
    });
    expect(evaluations.find((entry) => entry.capability === 'holistic_landmarks')).toMatchObject({
      status: 'disabled',
    });
  });

  it('marks requested optional perception capabilities as prototypes', () => {
    const evaluations = evaluatePerceptionCapabilities({
      enableHolisticPrototype: true,
      enableHandLandmarkerPrototype: true,
      enableFaceLandmarkerPrototype: true,
      enablePersonSegmentationPrototype: true,
      enableOnnxRuntimePrototype: true,
    });

    expect(evaluations.find((entry) => entry.capability === 'holistic_landmarks')).toMatchObject({
      status: 'prototype',
    });
    expect(evaluations.find((entry) => entry.capability === 'hand_landmarks')).toMatchObject({
      status: 'prototype',
    });
    expect(evaluations.find((entry) => entry.capability === 'face_landmarks')).toMatchObject({
      status: 'prototype',
    });
    expect(evaluations.find((entry) => entry.capability === 'person_segmentation')).toMatchObject({
      status: 'prototype',
    });
    expect(evaluations.find((entry) => entry.capability === 'onnx_runtime')).toMatchObject({
      status: 'prototype',
    });
  });
});
