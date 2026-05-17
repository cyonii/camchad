import {
  benchmarkSampleFor,
  summarizePoseBenchmark,
  type PoseBenchmarkSample,
  type PoseBenchmarkSummary,
} from './pose-benchmark.js';
import type { PoseEstimator, PoseEstimatorDelegate } from './pose-estimator.js';
import type { PoseModelQuality } from './pose-models.js';

export interface PoseRuntimeBenchmarkTarget {
  readonly modelQuality: PoseModelQuality;
  readonly delegate: PoseEstimatorDelegate;
  readonly createEstimator: () => PoseEstimator | Promise<PoseEstimator>;
}

export interface PoseRuntimeBenchmarkOptions {
  readonly video: HTMLVideoElement;
  readonly runtime: 'web' | 'electron';
  readonly targets: readonly PoseRuntimeBenchmarkTarget[];
  readonly frameCount: number;
  readonly frameTimeoutMs?: number;
  readonly now?: () => number;
  readonly waitForFrame?: (video: HTMLVideoElement, timeoutMs: number) => Promise<VideoFrameTiming>;
  readonly timestampForFrame?: (input: {
    readonly video: HTMLVideoElement;
    readonly frameIndex: number;
    readonly timing: VideoFrameTiming;
    readonly startedAtMs: number;
  }) => number;
}

export interface VideoFrameTiming {
  readonly ready: boolean;
  readonly mediaTimeSeconds?: number;
}

export interface PoseRuntimeBenchmarkResult {
  readonly runtime: 'web' | 'electron';
  readonly frameCount: number;
  readonly samples: readonly PoseBenchmarkSample[];
  readonly summaries: readonly PoseBenchmarkSummary[];
}

export async function runPoseRuntimeBenchmark(
  options: PoseRuntimeBenchmarkOptions,
): Promise<PoseRuntimeBenchmarkResult> {
  if (options.frameCount <= 0) {
    throw new Error('Pose runtime benchmark frameCount must be greater than zero.');
  }

  if (options.targets.length === 0) {
    throw new Error('Pose runtime benchmark requires at least one target.');
  }

  const now = options.now ?? defaultNow;
  const waitForFrame = options.waitForFrame ?? waitForVideoFrame;
  const frameTimeoutMs = options.frameTimeoutMs ?? 500;
  const samples: PoseBenchmarkSample[] = [];

  for (const target of options.targets) {
    const estimator = await target.createEstimator();

    await estimator.initialize();

    try {
      for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
        const timing = await waitForFrame(options.video, frameTimeoutMs);
        const startedAtMs = now();
        const videoTimestampMs =
          options.timestampForFrame?.({
            video: options.video,
            frameIndex,
            timing,
            startedAtMs,
          }) ?? timestampFromVideo(options.video, timing, startedAtMs);
        const poseDetected = estimator.estimate(options.video, videoTimestampMs) !== undefined;
        const endedAtMs = now();

        samples.push(
          benchmarkSampleFor({
            modelQuality: target.modelQuality,
            delegate: target.delegate,
            runtime: options.runtime,
            frameIndex,
            startedAtMs,
            endedAtMs,
            poseDetected,
            frameReady: timing.ready,
            videoTimestampMs,
          }),
        );
      }
    } finally {
      await estimator.dispose();
    }
  }

  return {
    runtime: options.runtime,
    frameCount: options.frameCount,
    samples,
    summaries: options.targets.flatMap((target) => {
      const summary = summarizePoseBenchmark(
        samples.filter(
          (sample) =>
            sample.modelQuality === target.modelQuality && sample.delegate === target.delegate,
        ),
      );

      return summary ? [summary] : [];
    }),
  };
}

async function waitForVideoFrame(
  video: HTMLVideoElement,
  timeoutMs: number,
): Promise<VideoFrameTiming> {
  const frameCallback = video.requestVideoFrameCallback?.bind(video);

  if (!frameCallback) {
    await delay(Math.min(timeoutMs, 34));

    return {
      ready: true,
      mediaTimeSeconds: Number.isFinite(video.currentTime) ? video.currentTime : undefined,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({ ready: false });
    }, timeoutMs);

    frameCallback((_now, metadata) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      resolve({
        ready: true,
        mediaTimeSeconds: metadata.mediaTime,
      });
    });
  });
}

function timestampFromVideo(
  video: HTMLVideoElement,
  timing: VideoFrameTiming,
  fallbackMs: number,
): number {
  const currentTime = timing.mediaTimeSeconds ?? video.currentTime;

  return Number.isFinite(currentTime) ? currentTime * 1000 : fallbackMs;
}

function defaultNow(): number {
  return performance.now();
}

async function delay(durationMs: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, durationMs));
}
