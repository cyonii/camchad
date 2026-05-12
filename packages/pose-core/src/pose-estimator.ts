import type { PoseFrame } from './landmarks.js';

export type PoseEstimatorDelegate = 'CPU' | 'GPU';

export interface PoseEstimator {
  initialize(): Promise<void>;
  estimate(video: HTMLVideoElement, timestampMs: number): PoseFrame | undefined;
  dispose(): Promise<void> | void;
}

export interface PoseEstimatorOptions {
  readonly modelAssetPath: string;
  readonly wasmAssetPath: string;
  readonly delegate?: PoseEstimatorDelegate;
  readonly minPoseDetectionConfidence?: number;
  readonly minPosePresenceConfidence?: number;
  readonly minTrackingConfidence?: number;
}
