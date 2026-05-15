import { describe, expect, it } from 'vitest';

import { extractBodyState } from './body-state.js';
import { ActivityStateSegmenter } from './activity-state-segmenter.js';
import { MovementWindow } from './movement-window.js';
import { makeSquatFrame } from './test-fixtures.js';

describe('ActivityStateSegmenter', () => {
  it('starts in setup while the temporal window is still warming', () => {
    const segmenter = new ActivityStateSegmenter({ minCoverage: 0.2 });
    const window = new MovementWindow({ maxAgeMs: 1000 });

    const state = segmenter.process(window.add(requiredBodyState(0, 168)));

    expect(state.state).toBe('setup');
    expect(state.evidence).toContain('warming_window');
  });

  it('detects movement from body and joint velocity over time', () => {
    const segmenter = new ActivityStateSegmenter({ minCoverage: 0.2 });
    const window = new MovementWindow({ maxAgeMs: 1000 });

    window.add(requiredBodyState(0, 168));
    const state = segmenter.process(window.add(requiredBodyState(160, 112)));

    expect(state.state).toBe('moving');
    expect(state.motionMagnitude).toBeGreaterThan(0.75);
    expect(state.lastMovementAtMs).toBe(160);
  });

  it('keeps movement active briefly before settling into rest', () => {
    const segmenter = new ActivityStateSegmenter({
      minCoverage: 0.2,
      restAfterMs: 300,
      idleAfterMs: 1000,
    });
    const window = new MovementWindow({ maxAgeMs: 2000 });

    window.add(requiredBodyState(0, 168));
    segmenter.process(window.add(requiredBodyState(160, 112)));
    const decay = segmenter.process(window.add(requiredBodyState(260, 112)));
    const resting = segmenter.process(window.add(requiredBodyState(620, 112)));

    expect(decay.state).toBe('moving');
    expect(decay.evidence).toContain('movement_decay_window');
    expect(resting.state).toBe('resting');
    expect(resting.evidence).toContain('recent_movement');
  });

  it('returns idle after stable tracking without recent movement', () => {
    const segmenter = new ActivityStateSegmenter({ minCoverage: 0.2, minWindowMs: 0 });
    const window = new MovementWindow({ maxAgeMs: 1000 });

    window.add(requiredBodyState(0, 168));
    const state = segmenter.process(window.add(requiredBodyState(240, 168)));

    expect(state.state).toBe('idle');
    expect(state.evidence).toContain('stable_body');
  });

  it('reports tracking lost for missing or low-quality samples', () => {
    const segmenter = new ActivityStateSegmenter({ minCoverage: 0.2 });
    const window = new MovementWindow({ maxAgeMs: 1000 });

    expect(segmenter.process(window.snapshot()).state).toBe('tracking_lost');

    window.add(requiredBodyState(0, 168));
    const state = segmenter.process(window.addMissing(100));

    expect(state.state).toBe('tracking_lost');
    expect(state.evidence).toContain('latest_sample_missing');
  });

  it('resets remembered movement state', () => {
    const segmenter = new ActivityStateSegmenter({
      minCoverage: 0.2,
      restAfterMs: 300,
      idleAfterMs: 1000,
    });
    const window = new MovementWindow({ maxAgeMs: 2000 });

    window.add(requiredBodyState(0, 168));
    segmenter.process(window.add(requiredBodyState(160, 112)));
    segmenter.reset();
    const state = segmenter.process(window.add(requiredBodyState(620, 112)));

    expect(state.state).toBe('idle');
    expect(state.lastMovementAtMs).toBeUndefined();
  });
});

function requiredBodyState(timestampMs: number, kneeAngle: number) {
  const bodyState = extractBodyState(makeSquatFrame({ timestampMs, kneeAngle }));

  if (!bodyState) {
    throw new Error('Expected fixture to produce a body state.');
  }

  return bodyState;
}
