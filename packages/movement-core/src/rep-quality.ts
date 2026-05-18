import type { RepEvent } from './movement-interpreter.js';

export interface RepQualityInput {
  readonly rangeScore: number;
  readonly alignmentScore: number;
  readonly rhythmScore?: number;
  readonly confidenceScore?: number;
  readonly trackingQualityScore?: number;
}

export type RepQualityComponents = Pick<
  RepEvent,
  | 'qualityScore'
  | 'rangeScore'
  | 'alignmentScore'
  | 'rhythmScore'
  | 'confidenceScore'
  | 'trackingQualityScore'
>;

export function buildRepQualityComponents(input: RepQualityInput): RepQualityComponents {
  const rangeScore = clamp01(input.rangeScore);
  const alignmentScore = clamp01(input.alignmentScore);
  const rhythmScore = clamp01(input.rhythmScore ?? 0);
  const confidenceScore = clamp01(input.confidenceScore ?? 0);
  const trackingQualityScore = clamp01(input.trackingQualityScore ?? 0);

  return {
    qualityScore: Math.round(
      (rangeScore * 0.35 +
        alignmentScore * 0.25 +
        rhythmScore * 0.15 +
        confidenceScore * 0.15 +
        trackingQualityScore * 0.1) *
        100,
    ),
    rangeScore,
    alignmentScore,
    rhythmScore,
    confidenceScore,
    trackingQualityScore,
  };
}

export function trackingQualityFromMetrics(metrics: Readonly<Record<string, number>>): number {
  return clamp01(1 - (metrics.missingSampleRatio ?? 0));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
