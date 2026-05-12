import { describe, expect, it } from 'vitest';

import { angleDegrees, lineDeviationRatio, midpoint } from './geometry.js';

describe('geometry helpers', () => {
  it('calculates joint angles in degrees', () => {
    expect(angleDegrees({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(90);
  });

  it('calculates midpoint without mutating inputs', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 2, y: 4 })).toEqual({ x: 1, y: 2 });
  });

  it('returns small line deviation for aligned body points', () => {
    expect(lineDeviationRatio({ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 })).toBeLessThan(
      0.02,
    );
  });
});
