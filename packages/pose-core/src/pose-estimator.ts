import type { PoseFrame } from './landmarks.js';
import type { PerceptionCapabilityFlags } from './perception-capabilities.js';
import type { PoseModelQuality } from './pose-models.js';

export type PoseEstimatorDelegate = 'CPU' | 'GPU';

export interface PoseEstimator {
  initialize(): Promise<void>;
  estimate(video: HTMLVideoElement, timestampMs: number): PoseFrame | undefined;
  dispose(): Promise<void> | void;
}

export interface PoseEstimatorOptions {
  readonly modelAssetPath: string;
  readonly wasmAssetPath: string;
  readonly modelQuality?: PoseModelQuality;
  readonly delegate?: PoseEstimatorDelegate;
  readonly minPoseDetectionConfidence?: number;
  readonly minPosePresenceConfidence?: number;
  readonly minTrackingConfidence?: number;
  readonly outputSegmentationMasks?: boolean;
  readonly capabilityFlags?: Partial<PerceptionCapabilityFlags>;
}
