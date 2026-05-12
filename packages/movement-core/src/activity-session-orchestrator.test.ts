import { describe, expect, it } from 'vitest';

import type { MovementInterpreterState } from './movement-interpreter.js';
import { ActivitySessionOrchestrator, cameraAdviceFor } from './activity-session-orchestrator.js';

describe('ActivitySessionOrchestrator', () => {
  it('starts movement telemetry when recognition becomes confident', () => {
    const orchestrator = new ActivitySessionOrchestrator({ cameraAngle: 'side' });

    const telemetry = orchestrator.process(
      movementState({
        recognition: {
          movementType: 'push_up',
          confidence: 0.82,
          status: 'active',
          evidence: ['test'],
        },
      }),
      1000,
    );

    expect(telemetry).toMatchObject({
      mode: 'moving',
      movementType: 'push_up',
      activeSetStartedAtMs: 1000,
      lastMovementAtMs: 1000,
    });
  });

  it('moves through resting and idle without losing deterministic set timing', () => {
    const orchestrator = new ActivitySessionOrchestrator({
      cameraAngle: 'side',
      restAfterMs: 1000,
      idleAfterMs: 3000,
    });

    orchestrator.process(activePushUpState(), 1000);

    expect(orchestrator.process(trackingLostState(), 2200)).toMatchObject({
      mode: 'resting',
      activeSetStartedAtMs: 1000,
      lastMovementAtMs: 1000,
    });
    expect(orchestrator.process(trackingLostState(), 4500)).toMatchObject({
      mode: 'idle',
    });
  });

  it('surfaces camera guidance from movement metadata', () => {
    expect(cameraAdviceFor('push_up', 'front_diagonal')).toMatchObject({
      severity: 'warning',
      recommendedAngle: 'side',
    });
  });
});

function activePushUpState(): MovementInterpreterState {
  return movementState({
    recognition: {
      movementType: 'push_up',
      confidence: 0.9,
      status: 'active',
      evidence: ['test'],
    },
  });
}

function trackingLostState(): MovementInterpreterState {
  return movementState({
    recognition: {
      confidence: 0,
      status: 'tracking_lost',
      evidence: [],
    },
    phase: 'tracking_lost',
  });
}

function movementState(overrides: Partial<MovementInterpreterState>): MovementInterpreterState {
  return {
    movementType: 'push_up',
    recognition: {
      confidence: 0,
      status: 'tracking_lost',
      evidence: [],
    },
    phase: 'setup_needed',
    reps: 0,
    validReps: 0,
    partialReps: 0,
    warnings: [],
    metrics: {},
    ...overrides,
  };
}
