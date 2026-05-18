import { describe, expect, it } from 'vitest';

import { extractBodyState } from './body-state.js';
import { evaluateCalibrationPreflight } from './calibration-preflight.js';
import { diagnoseMovement } from './movement-diagnostics.js';
import { makePushUpFrame } from './test-fixtures.js';

import type { MovementWindowSnapshot } from './movement-window.js';

describe('evaluateCalibrationPreflight', () => {
  it('waits until a body signal is present', () => {
    const preflight = evaluateCalibrationPreflight({
      activityState: {
        state: 'tracking_lost',
        confidence: 0,
        motionMagnitude: 0,
        evidence: ['no_body_state'],
      },
      diagnostics: { events: [] },
    });

    expect(preflight).toMatchObject({
      status: 'waiting',
      title: 'Calibrating view',
    });
  });

  it('blocks readiness on actionable guidance', () => {
    const bodyState = bodyStateFixture();
    const activityState = {
      state: 'idle' as const,
      confidence: 0.86,
      motionMagnitude: 0,
      evidence: ['stable_body'],
    };
    const diagnostics = diagnoseMovement({
      activityState,
      window: snapshotWithBodyState({
        ...bodyState,
        coverage: {
          ...bodyState.coverage,
          fullBody: 0.4,
        },
      }),
    });

    expect(
      evaluateCalibrationPreflight({
        activityState,
        diagnostics,
        window: snapshotWithBodyState(bodyState),
      }),
    ).toMatchObject({
      status: 'needs_adjustment',
      blockingGuidance: {
        code: 'full_body_not_visible',
      },
    });
  });

  it('marks calibration ready once signal quality is stable', () => {
    const bodyState = bodyStateFixture();
    const activityState = {
      state: 'idle' as const,
      confidence: 0.88,
      motionMagnitude: 0.01,
      evidence: ['stable_body'],
    };
    const window = snapshotWithBodyState(bodyState);

    expect(
      evaluateCalibrationPreflight({
        activityState,
        diagnostics: diagnoseMovement({ activityState, window }),
        window,
      }),
    ).toMatchObject({
      status: 'ready',
      title: 'Calibration ready',
    });
  });
});

function bodyStateFixture(): NonNullable<ReturnType<typeof extractBodyState>> {
  const bodyState = extractBodyState(makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }));

  if (!bodyState) {
    throw new Error('Expected fixture to produce body state.');
  }

  return bodyState;
}

function snapshotWithBodyState(
  bodyState: NonNullable<ReturnType<typeof extractBodyState>>,
): MovementWindowSnapshot {
  const sample = {
    timestampMs: bodyState.timestampMs,
    bodyState,
  };

  return {
    samples: [sample],
    validSamples: [sample],
    latest: sample,
    latestValid: sample,
    durationMs: 0,
    averageConfidence: bodyState.confidence,
    environment: {
      scaleStability: 1,
      centerStability: 1,
      landmarkJitter: 0,
    },
    missingSampleCount: 0,
    missingSampleRatio: 0,
  };
}
