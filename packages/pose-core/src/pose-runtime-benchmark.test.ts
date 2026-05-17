import { describe, expect, it } from 'vitest';

import { toLandmarkMap, type PoseFrame } from './landmarks.js';
import { runPoseRuntimeBenchmark, type VideoFrameTiming } from './pose-runtime-benchmark.js';
import type { PoseEstimator } from './pose-estimator.js';

describe('runPoseRuntimeBenchmark', () => {
  it('runs each target against video frames and summarizes runtime samples', async () => {
    let clock = 0;
    const result = await runPoseRuntimeBenchmark({
      video: { currentTime: 0 } as HTMLVideoElement,
      runtime: 'web',
      frameCount: 2,
      targets: [
        {
          modelQuality: 'lite',
          delegate: 'CPU',
          createEstimator: () => new FakeEstimator([true, false]),
        },
        {
          modelQuality: 'heavy',
          delegate: 'CPU',
          createEstimator: () => new FakeEstimator([true, true]),
        },
      ],
      now: () => {
        clock += 8;

        return clock;
      },
      waitForFrame: async (): Promise<VideoFrameTiming> => ({
        ready: true,
        mediaTimeSeconds: clock / 1000,
      }),
    });

    expect(result.samples).toHaveLength(4);
    expect(result.summaries).toHaveLength(2);
    expect(result.summaries[0]).toMatchObject({
      modelQuality: 'lite',
      runtime: 'web',
      sampleCount: 2,
      detectedFrameRatio: 0.5,
      averageLatencyMs: 8,
      estimatedFps: 125,
      droppedFrameRatio: 0,
    });
    expect(result.summaries[1]).toMatchObject({
      modelQuality: 'heavy',
      detectedFrameRatio: 1,
    });
  });

  it('records timed-out frame waits as dropped frames without hiding estimator results', async () => {
    let clock = 0;
    const result = await runPoseRuntimeBenchmark({
      video: { currentTime: 1 } as HTMLVideoElement,
      runtime: 'electron',
      frameCount: 2,
      targets: [
        {
          modelQuality: 'full',
          delegate: 'GPU',
          createEstimator: () => new FakeEstimator([true, true]),
        },
      ],
      now: () => {
        clock += 10;

        return clock;
      },
      waitForFrame: async (): Promise<VideoFrameTiming> => ({
        ready: false,
      }),
    });

    expect(result.summaries[0]).toMatchObject({
      modelQuality: 'full',
      delegate: 'GPU',
      runtime: 'electron',
      droppedFrameRatio: 1,
      detectedFrameRatio: 1,
    });
  });
});

class FakeEstimator implements PoseEstimator {
  private frameIndex = 0;

  public constructor(private readonly detections: readonly boolean[]) {}

  public initialize(): Promise<void> {
    return Promise.resolve();
  }

  public estimate(_video: HTMLVideoElement, timestampMs: number): PoseFrame | undefined {
    const detected = this.detections[this.frameIndex] ?? false;
    this.frameIndex += 1;

    return detected ? poseFrame(timestampMs) : undefined;
  }

  public dispose(): void {
    this.frameIndex = 0;
  }
}

function poseFrame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    confidence: 0.9,
    landmarks: toLandmarkMap([]),
  };
}
