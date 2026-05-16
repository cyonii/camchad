import { describe, expect, it } from 'vitest';

import { benchmarkSampleFor, summarizePoseBenchmark } from './pose-benchmark.js';

describe('pose benchmark summaries', () => {
  it('summarizes model latency, detection ratio, and estimated FPS', () => {
    const summary = summarizePoseBenchmark([
      benchmarkSampleFor(
        sample({ frameIndex: 0, startedAtMs: 0, endedAtMs: 10, poseDetected: true }),
      ),
      benchmarkSampleFor(
        sample({ frameIndex: 1, startedAtMs: 20, endedAtMs: 40, poseDetected: true }),
      ),
      benchmarkSampleFor(
        sample({ frameIndex: 2, startedAtMs: 50, endedAtMs: 80, poseDetected: false }),
      ),
    ]);

    expect(summary).toMatchObject({
      modelQuality: 'full',
      delegate: 'CPU',
      runtime: 'electron',
      sampleCount: 3,
      detectedFrameRatio: 2 / 3,
      averageLatencyMs: 20,
      p95LatencyMs: 30,
      estimatedFps: 50,
    });
  });

  it('returns undefined for an empty sample set', () => {
    expect(summarizePoseBenchmark([])).toBeUndefined();
  });
});

function sample(overrides: {
  readonly frameIndex: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly poseDetected: boolean;
}) {
  return {
    modelQuality: 'full' as const,
    delegate: 'CPU' as const,
    runtime: 'electron' as const,
    ...overrides,
  };
}
