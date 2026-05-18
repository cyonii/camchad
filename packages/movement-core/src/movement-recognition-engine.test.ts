import { describe, expect, it } from 'vitest';

import type { MovementInterpreter, MovementInterpreterState } from './movement-interpreter.js';
import {
  createMovementRecognitionEngine,
  MovementRecognitionEngine,
} from './movement-recognition-engine.js';
import { makeHighKneesSequence, makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('MovementRecognitionEngine', () => {
  it('selects the strongest recognized movement as the primary state', () => {
    const engine = new MovementRecognitionEngine([
      fakeInterpreter(
        movementState({
          recognition: {
            movementType: 'push_up',
            confidence: 0.9,
            status: 'tracking_lost',
            evidence: [],
          },
        }),
      ),
      fakeInterpreter(
        movementState({
          recognition: {
            movementType: 'push_up',
            confidence: 0.62,
            status: 'active',
            evidence: ['test'],
          },
          validReps: 2,
        }),
      ),
    ]);

    expect(engine.getState().primary).toMatchObject({
      recognition: {
        status: 'active',
      },
      validReps: 2,
    });
  });

  it('resets every interpreter owned by the engine', () => {
    const interpreters = [fakeInterpreter(movementState()), fakeInterpreter(movementState())];
    const engine = new MovementRecognitionEngine(interpreters);

    engine.reset();

    expect(interpreters.every((interpreter) => interpreter.resetCount === 1)).toBe(true);
  });

  it('distinguishes standing squat motion from floor push-up motion', () => {
    const engine = createMovementRecognitionEngine();

    engine.processPose(makeSquatFrame({ timestampMs: 0, kneeAngle: 168 }));
    engine.processPose(makeSquatFrame({ timestampMs: 120, kneeAngle: 138 }));
    engine.processPose(makeSquatFrame({ timestampMs: 260, kneeAngle: 96 }));
    const squatState = engine.processPose(
      makeSquatFrame({ timestampMs: 420, kneeAngle: 166 }),
    ).primary;

    engine.reset();
    engine.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 165 }));
    const pushUpState = engine.processPose(
      makePushUpFrame({ timestampMs: 140, elbowAngle: 132 }),
    ).primary;

    expect(squatState.movementType).toBe('squat');
    expect(pushUpState.movementType).toBe('push_up');
  });

  it('uses temporal confidence instead of promoting a single-frame spike', () => {
    const stable = sequencedInterpreter([
      movementState({
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.72,
          status: 'active',
          evidence: ['stable'],
        },
      }),
      movementState({
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.72,
          status: 'active',
          evidence: ['stable'],
        },
      }),
      movementState({
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.72,
          status: 'active',
          evidence: ['stable'],
        },
      }),
    ]);
    const spike = sequencedInterpreter([
      movementState({
        movementType: 'push_up',
        recognition: {
          movementType: 'push_up',
          confidence: 0.1,
          status: 'candidate',
          evidence: [],
        },
      }),
      movementState({
        movementType: 'push_up',
        recognition: {
          movementType: 'push_up',
          confidence: 0.1,
          status: 'candidate',
          evidence: [],
        },
      }),
      movementState({
        movementType: 'push_up',
        recognition: {
          movementType: 'push_up',
          confidence: 0.98,
          status: 'active',
          evidence: ['single_frame_spike'],
        },
      }),
    ]);
    const engine = new MovementRecognitionEngine([stable, spike]);

    engine.processPose(undefined);
    engine.processPose(undefined);
    const state = engine.processPose(undefined);

    expect(state.primary.movementType).toBe('squat');
    expect(state.primary.recognition.evidence).toContain('temporal_candidate_confidence');
    expect(
      state.candidates.find((candidate) => candidate.movementType === 'push_up')?.recognition
        .status,
    ).toBe('candidate');
  });

  it('uses hysteresis before switching the primary movement', () => {
    const squat = sequencedInterpreter([
      movementState({
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.82,
          status: 'active',
          evidence: ['squat_signal'],
        },
      }),
      movementState({
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.72,
          status: 'active',
          evidence: ['squat_signal'],
        },
      }),
      movementState({
        movementType: 'squat',
        recognition: {
          movementType: 'squat',
          confidence: 0.5,
          status: 'candidate',
          evidence: ['squat_signal'],
        },
      }),
    ]);
    const lunge = sequencedInterpreter([
      movementState({
        movementType: 'lunge',
        recognition: {
          movementType: 'lunge',
          confidence: 0.3,
          status: 'candidate',
          evidence: ['lunge_signal'],
        },
      }),
      movementState({
        movementType: 'lunge',
        recognition: {
          movementType: 'lunge',
          confidence: 0.78,
          status: 'active',
          evidence: ['lunge_signal'],
        },
      }),
      movementState({
        movementType: 'lunge',
        recognition: {
          movementType: 'lunge',
          confidence: 0.88,
          status: 'active',
          evidence: ['lunge_signal'],
        },
      }),
    ]);
    const engine = new MovementRecognitionEngine([squat, lunge]);

    expect(engine.processPose(undefined).primary.movementType).toBe('squat');
    expect(engine.processPose(undefined).primary.movementType).toBe('squat');
    expect(engine.processPose(undefined).primary.movementType).toBe('lunge');
  });

  it('marks inference as unknown when no candidate has enough confidence', () => {
    const engine = new MovementRecognitionEngine([
      fakeInterpreter(
        movementState({
          recognition: {
            movementType: 'push_up',
            confidence: 0.2,
            status: 'candidate',
            evidence: ['weak'],
          },
        }),
      ),
      fakeInterpreter(
        movementState({
          movementType: 'squat',
          recognition: {
            movementType: 'squat',
            confidence: 0.1,
            status: 'candidate',
            evidence: ['weak'],
          },
        }),
      ),
    ]);

    const state = engine.processPose(undefined);

    expect(state.inference).toMatchObject({
      status: 'unknown',
      evidence: ['insufficient_temporal_confidence'],
    });
  });

  it('marks inference as ambiguous when top candidates remain too close', () => {
    const engine = new MovementRecognitionEngine([
      fakeInterpreter(
        movementState({
          movementType: 'push_up',
          recognition: {
            movementType: 'push_up',
            confidence: 0.8,
            status: 'active',
            evidence: ['push'],
          },
        }),
      ),
      fakeInterpreter(
        movementState({
          movementType: 'squat',
          recognition: {
            movementType: 'squat',
            confidence: 0.78,
            status: 'active',
            evidence: ['squat'],
          },
        }),
      ),
    ]);

    engine.processPose(undefined);
    const state = engine.processPose(undefined);

    expect(state.inference.status).toBe('ambiguous');
    expect(state.inference.competingMovementTypes).toEqual(['push_up', 'squat']);
    expect(state.inference.confusion).toMatchObject({
      primaryMovementType: 'push_up',
      runnerUpMovementType: 'squat',
    });
    expect(state.inference.confusion?.confidenceGap).toBeLessThanOrEqual(0.08);
  });

  it('records shared and decisive evidence for candidate confusion', () => {
    const engine = new MovementRecognitionEngine([
      fakeInterpreter(
        movementState({
          movementType: 'push_up',
          recognition: {
            movementType: 'push_up',
            confidence: 0.86,
            status: 'active',
            evidence: ['profile_criteria_checked', 'floor_orientation_match', 'body_line_signal'],
          },
        }),
      ),
      fakeInterpreter(
        movementState({
          movementType: 'plank',
          recognition: {
            movementType: 'plank',
            confidence: 0.62,
            status: 'candidate',
            evidence: ['profile_criteria_checked', 'floor_orientation_match'],
          },
        }),
      ),
    ]);

    engine.processPose(undefined);
    const state = engine.processPose(undefined);

    expect(state.inference.confusion).toMatchObject({
      primaryMovementType: 'push_up',
      runnerUpMovementType: 'plank',
      sharedEvidence: expect.arrayContaining([
        'profile_criteria_checked',
        'floor_orientation_match',
      ]),
      decisiveEvidence: expect.arrayContaining(['body_line_signal']),
    });
  });

  it('adds declarative profile criteria evidence and metrics to count-ready candidates', () => {
    const sequence = makeHighKneesSequence();
    const engine = new MovementRecognitionEngine([
      sequencedInterpreter(
        sequence.map((_, index) =>
          movementState({
            movementType: 'high_knees',
            recognition: {
              movementType: 'high_knees',
              confidence: 0.62,
              status: 'active',
              evidence: [`frame_${index}`],
            },
          }),
        ),
      ),
    ]);

    engine.processPose(sequence[0]);
    const state = engine.processPose(sequence[1]);

    expect(state.primary.recognition.evidence).toContain('profile_criteria_checked');
    expect(state.primary.metrics.profileCriteriaConfidence).toBeGreaterThan(0);
    expect(state.primary.metrics.profileCriteriaPassed).toEqual(expect.any(Number));
  });

  it('applies declarative profile criteria to rep-validating candidates too', () => {
    const engine = new MovementRecognitionEngine([
      fakeInterpreter(
        movementState({
          movementType: 'push_up',
          recognition: {
            movementType: 'push_up',
            confidence: 0.74,
            status: 'active',
            evidence: ['rep_module_signal'],
          },
        }),
      ),
    ]);

    const state = engine.processPose(makePushUpFrame({ timestampMs: 0, elbowAngle: 152 }));

    expect(state.primary.recognition.evidence).toContain('profile_criteria_checked');
    expect(state.primary.metrics.profileCriteriaConfidence).toBeGreaterThan(0);
  });
});

function fakeInterpreter(
  state: MovementInterpreterState,
): MovementInterpreter & { resetCount: number } {
  return {
    movementType: 'push_up',
    resetCount: 0,
    processPose: () => state,
    getState: () => state,
    reset() {
      this.resetCount += 1;
    },
  };
}

function movementState(
  overrides: Partial<MovementInterpreterState> = {},
): MovementInterpreterState {
  return {
    movementType: 'push_up',
    recognition: {
      movementType: 'push_up',
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

function sequencedInterpreter(states: readonly MovementInterpreterState[]): MovementInterpreter {
  let index = 0;
  let state = states[0] as MovementInterpreterState;

  return {
    movementType: state.movementType,
    processPose: () => {
      state = states[Math.min(index, states.length - 1)] as MovementInterpreterState;
      index += 1;
      return state;
    },
    getState: () => state,
    reset: () => {
      index = 0;
      state = states[0] as MovementInterpreterState;
    },
  };
}
