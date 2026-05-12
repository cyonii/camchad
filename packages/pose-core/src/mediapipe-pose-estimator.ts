import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

import {
  mediapipeLandmarkNames,
  toLandmarkMap,
  type PoseFrame,
  type PoseLandmark,
} from './landmarks.js';
import type { PoseEstimator, PoseEstimatorOptions } from './pose-estimator.js';

export class MediaPipePoseEstimator implements PoseEstimator {
  private landmarker?: PoseLandmarker;

  public constructor(private readonly options: PoseEstimatorOptions) {}

  public async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(this.options.wasmAssetPath);

    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: this.options.modelAssetPath,
        delegate: this.options.delegate ?? 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: this.options.minPoseDetectionConfidence ?? 0.55,
      minPosePresenceConfidence: this.options.minPosePresenceConfidence ?? 0.55,
      minTrackingConfidence: this.options.minTrackingConfidence ?? 0.55,
    });
  }

  public estimate(video: HTMLVideoElement, timestampMs: number): PoseFrame | undefined {
    if (!this.landmarker) {
      throw new Error('MediaPipePoseEstimator must be initialized before estimate() is called.');
    }

    return toPoseFrame(this.landmarker.detectForVideo(video, timestampMs), timestampMs);
  }

  public dispose(): void {
    this.landmarker?.close();
    this.landmarker = undefined;
  }
}

export function toPoseFrame(
  result: PoseLandmarkerResult,
  timestampMs: number,
): PoseFrame | undefined {
  const landmarks = result.landmarks[0];

  if (!landmarks) {
    return undefined;
  }

  const mapped = mapLandmarks(landmarks);
  const confidence =
    mapped.reduce((sum, landmark) => sum + (landmark.visibility ?? landmark.presence ?? 0), 0) /
    mapped.length;

  return {
    timestampMs,
    landmarks: toLandmarkMap(mapped),
    worldLandmarks: result.worldLandmarks[0]
      ? toLandmarkMap(mapLandmarks(result.worldLandmarks[0]))
      : undefined,
    confidence,
  };
}

function mapLandmarks(landmarks: readonly NormalizedLandmark[]): PoseLandmark[] {
  return landmarks.flatMap((landmark, index) => {
    const name = mediapipeLandmarkNames[index];

    if (!name) {
      return [];
    }

    return {
      name,
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.visibility,
    };
  });
}
