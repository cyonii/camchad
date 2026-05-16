export type PoseModelQuality = 'lite' | 'full' | 'heavy';

export interface PoseModelProfile {
  readonly quality: PoseModelQuality;
  readonly label: string;
  readonly expectedRuntimeCost: 'low' | 'medium' | 'high';
  readonly recommendedUse: string;
  readonly modelFilename: string;
}

export const poseModelProfiles: Readonly<Record<PoseModelQuality, PoseModelProfile>> = {
  lite: {
    quality: 'lite',
    label: 'Pose Lite',
    expectedRuntimeCost: 'low',
    recommendedUse: 'Fast startup, older machines, and battery-sensitive sessions.',
    modelFilename: 'pose_landmarker_lite.task',
  },
  full: {
    quality: 'full',
    label: 'Pose Full',
    expectedRuntimeCost: 'medium',
    recommendedUse: 'Default local analysis profile when FPS remains stable.',
    modelFilename: 'pose_landmarker_full.task',
  },
  heavy: {
    quality: 'heavy',
    label: 'Pose Heavy',
    expectedRuntimeCost: 'high',
    recommendedUse: 'Quality experiments only until local FPS and latency justify it.',
    modelFilename: 'pose_landmarker_heavy.task',
  },
};

export function poseModelProfileFor(quality: PoseModelQuality): PoseModelProfile {
  return poseModelProfiles[quality];
}

export function poseModelAssetPath(basePath: string, quality: PoseModelQuality): string {
  return joinPath(basePath, poseModelProfileFor(quality).modelFilename);
}

function joinPath(basePath: string, filename: string): string {
  return `${basePath.replace(/\/+$/u, '')}/${filename}`;
}
