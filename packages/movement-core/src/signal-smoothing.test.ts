import { describe, expect, it } from 'vitest';

import {
  ExponentialSignalFilter,
  MovingMedianSignalFilter,
  OneEuroSignalFilter,
} from './signal-smoothing.js';

describe('signal smoothing filters', () => {
  it('smooths scalar values with exponential weighting', () => {
    const filter = new ExponentialSignalFilter(0.5);

    expect(filter.add(10)).toBe(10);
    expect(filter.add(20)).toBe(15);
    expect(filter.add(20)).toBe(17.5);
  });

  it('suppresses isolated outliers with a moving median', () => {
    const filter = new MovingMedianSignalFilter(3);

    expect(filter.add(10)).toBe(10);
    expect(filter.add(11)).toBe(10.5);
    expect(filter.add(80)).toBe(11);
    expect(filter.add(12)).toBe(12);
  });

  it('uses timestamps to adapt One Euro smoothing deterministically', () => {
    const filter = new OneEuroSignalFilter({
      minCutoff: 1,
      beta: 0,
      derivativeCutoff: 1,
    });

    expect(filter.add(0, 0)).toBe(0);
    const slowStep = filter.add(10, 16);
    const laterStep = filter.add(10, 116);

    expect(slowStep).toBeGreaterThan(0);
    expect(slowStep).toBeLessThan(10);
    expect(laterStep).toBeGreaterThan(slowStep);
  });

  it('lets One Euro beta respond faster to large movement', () => {
    const slowFilter = new OneEuroSignalFilter({
      minCutoff: 1,
      beta: 0,
      derivativeCutoff: 1,
    });
    const adaptiveFilter = new OneEuroSignalFilter({
      minCutoff: 1,
      beta: 0.5,
      derivativeCutoff: 1,
    });

    slowFilter.add(0, 0);
    adaptiveFilter.add(0, 0);

    expect(adaptiveFilter.add(10, 16)).toBeGreaterThan(slowFilter.add(10, 16));
  });

  it('resets filters back to their initial state', () => {
    const exponential = new ExponentialSignalFilter(0.5);
    const median = new MovingMedianSignalFilter(3);
    const oneEuro = new OneEuroSignalFilter();

    exponential.add(10);
    median.add(10);
    oneEuro.add(10, 0);

    exponential.reset();
    median.reset();
    oneEuro.reset();

    expect(exponential.add(20)).toBe(20);
    expect(median.add(20)).toBe(20);
    expect(oneEuro.add(20, 100)).toBe(20);
  });

  it('rejects invalid filter configuration', () => {
    expect(() => new ExponentialSignalFilter(2)).toThrow(/alpha/);
    expect(() => new MovingMedianSignalFilter(0)).toThrow(/windowSize/);
    expect(() => new OneEuroSignalFilter({ minCutoff: 0 })).toThrow(/cutoff/);
    expect(() => new OneEuroSignalFilter({ beta: -1 })).toThrow(/beta/);
  });
});
