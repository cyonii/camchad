import type { PoseFrame, PoseLandmark, PoseLandmarkMap } from './landmarks.js';

export class ExponentialPoseSmoother {
  private previous?: PoseFrame;

  public constructor(private readonly alpha = 0.65) {}

  public reset(): void {
    this.previous = undefined;
  }

  public smooth(frame: PoseFrame): PoseFrame {
    if (!this.previous) {
      this.previous = frame;
      return frame;
    }

    const smoothed: PoseFrame = {
      ...frame,
      landmarks: smoothMap(this.previous.landmarks, frame.landmarks, this.alpha),
      worldLandmarks: frame.worldLandmarks
        ? smoothMap(this.previous.worldLandmarks, frame.worldLandmarks, this.alpha)
        : undefined,
      confidence: this.previous.confidence * (1 - this.alpha) + frame.confidence * this.alpha,
    };

    this.previous = smoothed;
    return smoothed;
  }
}

function smoothMap(
  previous: PoseLandmarkMap | undefined,
  current: PoseLandmarkMap,
  alpha: number,
): PoseLandmarkMap {
  if (!previous) {
    return current;
  }

  const smoothed = new Map(current);

  for (const [name, landmark] of current) {
    const old = previous.get(name);

    if (!old) {
      continue;
    }

    const next: PoseLandmark = {
      ...landmark,
      x: old.x * (1 - alpha) + landmark.x * alpha,
      y: old.y * (1 - alpha) + landmark.y * alpha,
      z:
        old.z === undefined || landmark.z === undefined
          ? landmark.z
          : old.z * (1 - alpha) + landmark.z * alpha,
      visibility:
        old.visibility === undefined || landmark.visibility === undefined
          ? landmark.visibility
          : old.visibility * (1 - alpha) + landmark.visibility * alpha,
      presence:
        old.presence === undefined || landmark.presence === undefined
          ? landmark.presence
          : old.presence * (1 - alpha) + landmark.presence * alpha,
    };

    smoothed.set(name, next);
  }

  return smoothed;
}
