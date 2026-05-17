import { describe, expect, it } from 'vitest';

import { createMovementRecognitionEngine } from './movement-recognition-engine.js';
import { createRepValidatingMovementInterpreter } from './rep-validating-movement-interpreter.js';
import {
  makeForwardLeaningSquatSequence,
  makeConfusedStandingSequence,
  makeDeadliftLikeSequence,
  makeHighKneesSequence,
  makeInvalidPushUpAlignmentSequence,
  makeLungeLikeSequence,
  makePausedSquatSequence,
  makePartialPushUpSequence,
  makePushUpFrame,
  makePushUpRepSequence,
  makeShallowSquatSequence,
  makeSquatRepSequence,
  evaluateMovementReplay,
  replayMovementSequence,
  replayRecognitionSequence,
} from './test-fixtures.js';

describe('movement sequence replay', () => {
  it('summarizes a full push-up sequence with phase changes and one valid rep', () => {
    const replay = replayMovementSequence(
      createRepValidatingMovementInterpreter('push_up'),
      makePushUpRepSequence(),
    );

    expect(replay.finalState).toMatchObject({
      movementType: 'push_up',
      phase: 'top',
      reps: 1,
      validReps: 1,
      partialReps: 0,
    });
    expect(replay.repEvents).toHaveLength(1);
    expect(replay.phaseChanges.map((state) => state.phase)).toEqual([
      'top',
      'descending',
      'bottom',
      'ascending',
      'top',
    ]);
    expect(replay.activeFrameCount).toBeGreaterThan(0);
    expect(replay.trackingLostFrameCount).toBe(0);
    expect(
      evaluateMovementReplay(replay, { expectedReps: 1, allowActiveFrames: true }),
    ).toMatchObject({
      repCountAccuracy: 1,
      falseActivationCount: 0,
    });
    expect(replay.metrics.confidenceStability).toBeGreaterThan(0.8);
  });

  it('summarizes an incomplete push-up sequence as a partial rep', () => {
    const replay = replayMovementSequence(
      createRepValidatingMovementInterpreter('push_up'),
      makePartialPushUpSequence(),
    );

    expect(replay.finalState.reps).toBe(1);
    expect(replay.finalState.validReps).toBe(0);
    expect(replay.finalState.partialReps).toBe(1);
    expect(replay.repEvents[0]?.warnings.some((warning) => warning.code === 'partial_depth')).toBe(
      true,
    );
  });

  it('summarizes invalid push-up alignment without counting a rep', () => {
    const replay = replayMovementSequence(
      createRepValidatingMovementInterpreter('push_up'),
      makeInvalidPushUpAlignmentSequence(),
    );

    expect(replay.finalState.phase).toBe('invalid_form');
    expect(replay.finalState.reps).toBe(0);
    expect(replay.finalState.warnings.some((warning) => warning.code === 'body_alignment')).toBe(
      true,
    );
    expect(
      evaluateMovementReplay(replay, { expectedReps: 0 }).falseActivationCount,
    ).toBeGreaterThan(0);
  });

  it('captures tracking loss and recovery inside a push-up trace', () => {
    const replay = replayMovementSequence(createRepValidatingMovementInterpreter('push_up'), [
      makePushUpFrame({ timestampMs: 0, elbowAngle: 166 }),
      undefined,
      makePushUpFrame({ timestampMs: 220, elbowAngle: 164 }),
    ]);

    expect(replay.trackingLostFrameCount).toBe(1);
    expect(replay.phaseChanges.map((state) => state.phase)).toEqual([
      'top',
      'tracking_lost',
      'top',
    ]);
    expect(replay.finalState.recognition.status).toBe('active');
  });

  it('summarizes a full squat sequence with one valid rep', () => {
    const replay = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeSquatRepSequence(),
    );

    expect(replay.finalState).toMatchObject({
      movementType: 'squat',
      phase: 'top',
      reps: 1,
      validReps: 1,
      partialReps: 0,
    });
    expect(replay.repEvents).toHaveLength(1);
    expect(replay.phaseChanges.map((state) => state.phase)).toEqual([
      'top',
      'descending',
      'bottom',
      'ascending',
      'top',
    ]);
  });

  it('summarizes squat posture warnings without losing the valid rep', () => {
    const replay = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeForwardLeaningSquatSequence(),
    );

    expect(replay.finalState.reps).toBe(1);
    expect(replay.finalState.validReps).toBe(1);
    expect(replay.finalState.warnings.some((warning) => warning.code === 'posture_alignment')).toBe(
      true,
    );
  });

  it('distinguishes shallow, paused, and confused squat traces', () => {
    const shallow = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeShallowSquatSequence(),
    );
    const paused = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makePausedSquatSequence(),
    );
    const confused = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeConfusedStandingSequence(),
    );

    expect(shallow.finalState).toMatchObject({
      reps: 1,
      validReps: 0,
      partialReps: 1,
    });
    expect(paused.finalState).toMatchObject({
      reps: 1,
      validReps: 1,
      partialReps: 0,
    });
    expect(confused.finalState.reps).toBe(0);
    expect(confused.metrics.phaseJitter).toBeLessThan(0.6);
  });

  it('does not absorb high knees, lunges, or hinge patterns into squat counting', () => {
    const highKnees = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeHighKneesSequence(),
    );
    const lunge = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeLungeLikeSequence(),
    );
    const deadlift = replayMovementSequence(
      createRepValidatingMovementInterpreter('squat'),
      makeDeadliftLikeSequence(),
    );

    expect(highKnees.finalState.reps).toBe(0);
    expect(highKnees.finalState.recognition.evidence).toContain('knee_lift_pattern_not_squat');
    expect(lunge.finalState.reps).toBe(0);
    expect(lunge.finalState.recognition.evidence).toContain('split_stance_pattern_not_squat');
    expect(deadlift.finalState.reps).toBe(0);
    expect(deadlift.finalState.recognition.evidence).toContain('hip_hinge_pattern_not_squat');
  });

  it('replays exercise transitions through the recognition engine', () => {
    const replay = replayRecognitionSequence(createMovementRecognitionEngine(), [
      ...makePushUpRepSequence(0),
      undefined,
      ...makeSquatRepSequence(900),
    ]);

    expect(replay.primaryMovementTypes).toContain('push_up');
    expect(replay.primaryMovementTypes).toContain('squat');
    expect(replay.metrics.primarySwitchCount).toBeGreaterThanOrEqual(1);
    expect(replay.metrics.primaryStability).toBeGreaterThan(0.5);
    expect(replay.finalState.primary).toMatchObject({
      movementType: 'squat',
      reps: 1,
      validReps: 1,
    });
  });
});
