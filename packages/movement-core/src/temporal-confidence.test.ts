import { describe, expect, it } from 'vitest';

import { TemporalConfidenceAccumulator } from './temporal-confidence.js';

describe('TemporalConfidenceAccumulator', () => {
  it('accumulates repeated evidence before becoming active', () => {
    const confidence = new TemporalConfidenceAccumulator({
      activationThreshold: 0.6,
      deactivationThreshold: 0.35,
      candidateThreshold: 0.4,
      riseAlpha: 0.5,
      fallAlpha: 0.5,
    });

    expect(confidence.addSample(0.8).state).toBe('candidate');
    const active = confidence.addSample(0.8);

    expect(active.state).toBe('active');
    expect(active.confidence).toBeCloseTo(0.6);
    expect(active.sampleCount).toBe(2);
    expect(active.activeSampleCount).toBe(1);
  });

  it('uses hysteresis so active confidence does not drop immediately', () => {
    const confidence = new TemporalConfidenceAccumulator({
      activationThreshold: 0.7,
      deactivationThreshold: 0.35,
      riseAlpha: 1,
      fallAlpha: 0.25,
    });

    confidence.addSample(0.8);
    expect(confidence.snapshot().state).toBe('active');

    const snapshot = confidence.addSample(0.2);

    expect(snapshot.state).toBe('active');
    expect(snapshot.confidence).toBeCloseTo(0.65);
  });

  it('falls back to candidate once active confidence crosses the deactivation threshold', () => {
    const confidence = new TemporalConfidenceAccumulator({
      activationThreshold: 0.7,
      deactivationThreshold: 0.45,
      riseAlpha: 1,
      fallAlpha: 1,
    });

    confidence.addSample(0.8);
    const snapshot = confidence.addSample(0.2);

    expect(snapshot.state).toBe('candidate');
    expect(snapshot.confidence).toBeCloseTo(0.2);
  });

  it('clamps raw confidence samples into the valid range', () => {
    const confidence = new TemporalConfidenceAccumulator({
      activationThreshold: 0.9,
      deactivationThreshold: 0.4,
      riseAlpha: 1,
      fallAlpha: 1,
    });

    expect(confidence.addSample(2).confidence).toBe(1);
    expect(confidence.addSample(-1).confidence).toBe(0);
  });

  it('resets accumulated state', () => {
    const confidence = new TemporalConfidenceAccumulator({
      activationThreshold: 0.7,
      deactivationThreshold: 0.45,
      riseAlpha: 1,
    });

    confidence.addSample(0.9);
    confidence.reset();

    expect(confidence.snapshot()).toEqual({
      state: 'inactive',
      confidence: 0,
      sampleCount: 0,
      activeSampleCount: 0,
    });
  });

  it('rejects invalid thresholds', () => {
    expect(
      () =>
        new TemporalConfidenceAccumulator({
          activationThreshold: 0.5,
          deactivationThreshold: 0.8,
        }),
    ).toThrow(/deactivationThreshold/);

    expect(
      () =>
        new TemporalConfidenceAccumulator({
          activationThreshold: 0.7,
          deactivationThreshold: 0.4,
          candidateThreshold: 0.2,
        }),
    ).toThrow(/candidateThreshold/);
  });
});
