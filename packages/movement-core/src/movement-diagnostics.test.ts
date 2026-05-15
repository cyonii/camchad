import { describe, expect, it } from 'vitest';

import { diagnoseMovement } from './movement-diagnostics.js';

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
        missingSampleCount: 0,
        missingSampleRatio: 0,
      },
    });

    expect(diagnostics.primary).toMatchObject({
      code: 'conditions_usable',
      severity: 'info',
    });
  });
});
