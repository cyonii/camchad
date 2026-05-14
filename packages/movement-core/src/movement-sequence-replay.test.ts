import { describe, expect, it } from 'vitest';

import { createMovementRecognitionEngine } from './movement-recognition-engine.js';
import { PushUpMovementInterpreter } from './push-up-interpreter.js';
import { SquatMovementInterpreter } from './squat-interpreter.js';
import {
  makePartialPushUpSequence,
  makePushUpRepSequence,
  makeSquatRepSequence,
  replayMovementSequence,
  replayRecognitionSequence,
} from './test-fixtures.js';

describe('movement sequence replay', () => {
  it('summarizes a full push-up sequence with phase changes and one valid rep', () => {
    const replay = replayMovementSequence(new PushUpMovementInterpreter(), makePushUpRepSequence());

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
  });

  it('summarizes an incomplete push-up sequence as a partial rep', () => {
    const replay = replayMovementSequence(
      new PushUpMovementInterpreter(),
      makePartialPushUpSequence(),
    );

    expect(replay.finalState.reps).toBe(1);
    expect(replay.finalState.validReps).toBe(0);
    expect(replay.finalState.partialReps).toBe(1);
    expect(replay.repEvents[0]?.warnings.some((warning) => warning.code === 'partial_depth')).toBe(
      true,
    );
  });

  it('summarizes a full squat sequence with one valid rep', () => {
    const replay = replayMovementSequence(new SquatMovementInterpreter(), makeSquatRepSequence());

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

  it('replays exercise transitions through the recognition engine', () => {
    const replay = replayRecognitionSequence(createMovementRecognitionEngine(), [
      ...makePushUpRepSequence(0),
      undefined,
      ...makeSquatRepSequence(900),
    ]);

    expect(replay.primaryMovementTypes).toContain('push_up');
    expect(replay.primaryMovementTypes).toContain('squat');
    expect(replay.finalState.primary).toMatchObject({
      movementType: 'squat',
      reps: 1,
      validReps: 1,
    });
  });
});
