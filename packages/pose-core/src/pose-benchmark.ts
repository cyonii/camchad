import type { PoseEstimatorDelegate } from './pose-estimator.js';
import type { PoseModelQuality } from './pose-models.js';

export interface PoseBenchmarkSample {
  readonly modelQuality: PoseModelQuality;
  readonly delegate: PoseEstimatorDelegate;
  readonly runtime: 'web' | 'electron';
  readonly frameIndex: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly poseDetected: boolean;
}

export interface PoseBenchmarkSummary {
  readonly modelQuality: PoseModelQuality;
  readonly delegate: PoseEstimatorDelegate;
  readonly runtime: 'web' | 'electron';
  readonly sampleCount: number;
  readonly detectedFrameRatio: number;
  readonly averageLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly estimatedFps: number;
}

export function summarizePoseBenchmark(
  samples: readonly PoseBenchmarkSample[],
): PoseBenchmarkSummary | undefined {
  if (samples.length === 0) {
    return undefined;
  }

  const [first] = samples;

  if (!first) {
    return undefined;
  }

  const latencies = samples
    .map((sample) => Math.max(0, sample.endedAtMs - sample.startedAtMs))
    .sort((a, b) => a - b);
  const averageLatencyMs = average(latencies);

  return {
    modelQuality: first.modelQuality,
    delegate: first.delegate,
    runtime: first.runtime,
    sampleCount: samples.length,
    detectedFrameRatio: samples.filter((sample) => sample.poseDetected).length / samples.length,
    averageLatencyMs,
    p95LatencyMs: percentile(latencies, 0.95),
    estimatedFps: averageLatencyMs <= 0 ? 0 : 1000 / averageLatencyMs,
  };
}

export function benchmarkSampleFor(options: {
  readonly modelQuality: PoseModelQuality;
  readonly delegate: PoseEstimatorDelegate;
  readonly runtime: 'web' | 'electron';
  readonly frameIndex: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly poseDetected: boolean;
}): PoseBenchmarkSample {
  return options;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));

  return values[index] ?? 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
