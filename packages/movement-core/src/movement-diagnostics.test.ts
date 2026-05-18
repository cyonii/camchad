import { describe, expect, it } from 'vitest';

import { extractBodyState } from './body-state.js';
import { diagnoseMovement } from './movement-diagnostics.js';
import { makePushUpFrame } from './test-fixtures.js';

import type { MovementWindowSnapshot } from './movement-window.js';

describe('diagnoseMovement', () => {
  it('reports tracking loss as the primary guidance event', () => {
    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'tracking_lost',
        confidence: 0.1,
        motionMagnitude: 0,
        evidence: ['low_tracking_quality'],
      },
    });

    expect(diagnostics.primary).toMatchObject({
      code: 'tracking_lost',
      severity: 'warning',
    });
  });

  it('reports recent tracking gaps from the movement window', () => {
    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'moving',
        confidence: 0.8,
        motionMagnitude: 1,
        evidence: ['body_motion_threshold'],
      },
      window: {
        samples: [],
        validSamples: [],
        durationMs: 300,
        averageConfidence: 0.8,
        environment: {
          scaleStability: 1,
          centerStability: 1,
          landmarkJitter: 0,
        },
        missingSampleCount: 2,
        missingSampleRatio: 0.4,
      },
    });

    expect(diagnostics.events.some((event) => event.code === 'recent_tracking_gap')).toBe(true);
  });

  it('surfaces orientation mismatch evidence from an interpreter state', () => {
    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'setup',
        confidence: 0.7,
        motionMagnitude: 0.1,
        evidence: ['warming_window'],
      },
      interpreterState: {
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.12,
          status: 'candidate',
          evidence: ['body_orientation_mismatch'],
        },
        phase: 'setup_needed',
        reps: 0,
        validReps: 0,
        partialReps: 0,
        warnings: [],
        metrics: {},
      },
    });

    expect(diagnostics.events.some((event) => event.code === 'orientation_mismatch')).toBe(true);
    expect(diagnostics.events.some((event) => event.code === 'side_angle_recommended')).toBe(true);
  });

  it('emits a usable-conditions event when signal quality is stable', () => {
    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'idle',
        confidence: 0.82,
        motionMagnitude: 0.01,
        evidence: ['stable_body'],
      },
      window: {
        samples: [],
        validSamples: [],
        durationMs: 300,
        averageConfidence: 0.85,
        environment: {
          scaleStability: 1,
          centerStability: 1,
          landmarkJitter: 0,
        },
        missingSampleCount: 0,
        missingSampleRatio: 0,
      },
    });

    expect(diagnostics.primary).toMatchObject({
      code: 'conditions_usable',
      severity: 'info',
    });
  });

  it('surfaces low-confidence body regions as environmental guidance', () => {
    const bodyState = extractBodyState(
      makePushUpFrame({ timestampMs: 0, elbowAngle: 150, rightVisibility: 0.1 }),
    );

    if (!bodyState) {
      throw new Error('Expected fixture to produce body state.');
    }

    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'idle',
        confidence: 0.82,
        motionMagnitude: 0.01,
        evidence: ['stable_body'],
      },
      window: snapshotWithBodyState(bodyState),
    });

    expect(diagnostics.events.some((event) => event.code === 'hands_missing')).toBe(true);
    expect(diagnostics.events.some((event) => event.code === 'feet_missing')).toBe(true);
  });

  it('reports lower-body framing risk when upper body is visible but legs are missing', () => {
    const bodyState = extractBodyState(
      makePushUpFrame({ timestampMs: 0, elbowAngle: 150, rightVisibility: 0.95 }),
    );

    if (!bodyState) {
      throw new Error('Expected fixture to produce body state.');
    }

    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'idle',
        confidence: 0.82,
        motionMagnitude: 0.01,
        evidence: ['stable_body'],
      },
      window: snapshotWithBodyState({
        ...bodyState,
        coverage: {
          ...bodyState.coverage,
          upperBody: 0.8,
          lowerBody: 0.3,
        },
      }),
    });

    expect(diagnostics.events.some((event) => event.code === 'camera_too_low')).toBe(true);
  });

  it('surfaces camera distance and frame-edge guidance from body environment', () => {
    const bodyState = extractBodyState(makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }));

    if (!bodyState) {
      throw new Error('Expected fixture to produce body state.');
    }

    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'idle',
        confidence: 0.82,
        motionMagnitude: 0.01,
        evidence: ['stable_body'],
      },
      window: snapshotWithBodyState({
        ...bodyState,
        environment: {
          ...bodyState.environment,
          cameraDistance: 'too_close',
          edgeProximityRisk: 0.8,
        },
      }),
    });

    expect(diagnostics.events.some((event) => event.code === 'camera_too_close')).toBe(true);
    expect(diagnostics.events.some((event) => event.code === 'body_near_edge')).toBe(true);
  });

  it('surfaces unstable temporal environment guidance from the movement window', () => {
    const bodyState = extractBodyState(makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }));

    if (!bodyState) {
      throw new Error('Expected fixture to produce body state.');
    }

    const diagnostics = diagnoseMovement({
      activityState: {
        state: 'idle',
        confidence: 0.82,
        motionMagnitude: 0.01,
        evidence: ['stable_body'],
      },
      window: {
        ...snapshotWithBodyState(bodyState),
        environment: {
          scaleStability: 0.5,
          centerStability: 0.4,
          landmarkJitter: 0.12,
        },
      },
    });

    expect(diagnostics.events.some((event) => event.code === 'unstable_camera_distance')).toBe(
      true,
    );
    expect(diagnostics.events.some((event) => event.code === 'frame_drift')).toBe(true);
    expect(diagnostics.events.some((event) => event.code === 'landmark_jitter')).toBe(true);
  });
});

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
