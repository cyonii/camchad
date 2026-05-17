import { describe, expect, it } from 'vitest';

import {
  createMovementProfileWindow,
  evaluateMovementProfileFrame,
} from './movement-profile-evaluation-context.js';
import { makeSquatFrame } from './test-fixtures.js';

describe('movement profile evaluation context', () => {
  it('bundles body state, movement window, and profile visibility settings', () => {
    const window = createMovementProfileWindow({ maxAgeMs: 1000 });
    const context = evaluateMovementProfileFrame({
      frame: makeSquatFrame({ timestampMs: 100, kneeAngle: 168 }),
      window,
    });

    expect(context).toMatchObject({
      bodyState: {
        timestampMs: 100,
        orientation: {
          kind: 'standing',
        },
      },
      window: {
        validSamples: expect.arrayContaining([
          expect.objectContaining({
            timestampMs: 100,
          }),
        ]),
      },
      minVisibility: 0.45,
    });
  });

  it('records timestamped missing samples when pose landmarks cannot produce a body state', () => {
    const window = createMovementProfileWindow({ maxAgeMs: 1000 });
    const context = evaluateMovementProfileFrame({
      frame: {
        timestampMs: 120,
        confidence: 0,
        landmarks: new Map(),
      },
      window,
    });

    expect(context).toBeUndefined();
    expect(window.snapshot()).toMatchObject({
      missingSampleCount: 1,
      latest: {
        timestampMs: 120,
      },
    });
  });
});
