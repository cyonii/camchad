export type PerceptionCapability =
  | 'pose_landmarks'
  | 'pose_world_landmarks'
  | 'pose_segmentation'
  | 'holistic_landmarks'
  | 'hand_landmarks'
  | 'face_landmarks'
  | 'person_segmentation'
  | 'onnx_runtime';

export interface PerceptionCapabilityFlags {
  readonly enablePoseSegmentation: boolean;
  readonly enableHolisticPrototype: boolean;
  readonly enableHandLandmarkerPrototype: boolean;
  readonly enableFaceLandmarkerPrototype: boolean;
  readonly enablePersonSegmentationPrototype: boolean;
  readonly enableOnnxRuntimePrototype: boolean;
}

export const defaultPerceptionCapabilityFlags: PerceptionCapabilityFlags = {
  enablePoseSegmentation: false,
  enableHolisticPrototype: false,
  enableHandLandmarkerPrototype: false,
  enableFaceLandmarkerPrototype: false,
  enablePersonSegmentationPrototype: false,
  enableOnnxRuntimePrototype: false,
};

export function enabledPerceptionCapabilities(
  flags: Partial<PerceptionCapabilityFlags> = {},
): readonly PerceptionCapability[] {
  const resolved = {
    ...defaultPerceptionCapabilityFlags,
    ...flags,
  };
  const capabilities: PerceptionCapability[] = ['pose_landmarks', 'pose_world_landmarks'];

  if (resolved.enablePoseSegmentation) {
    capabilities.push('pose_segmentation');
  }

  if (resolved.enableHolisticPrototype) {
    capabilities.push('holistic_landmarks');
  }

  if (resolved.enableHandLandmarkerPrototype) {
    capabilities.push('hand_landmarks');
  }

  if (resolved.enableFaceLandmarkerPrototype) {
    capabilities.push('face_landmarks');
  }

  if (resolved.enablePersonSegmentationPrototype) {
    capabilities.push('person_segmentation');
  }

  if (resolved.enableOnnxRuntimePrototype) {
    capabilities.push('onnx_runtime');
  }

  return capabilities;
}
