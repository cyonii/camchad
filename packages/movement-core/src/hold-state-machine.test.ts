import { describe, expect, it } from 'vitest';

import { HoldStateMachine } from './hold-state-machine.js';

describe('HoldStateMachine', () => {
  it('enters holding and completes after the configured duration', () => {
    const machine = new HoldStateMachine({
      minHoldMs: 1000,
      enterConfidence: 0.75,
      exitConfidence: 0.55,
    });

    expect(machine.update({ timestampMs: 0, holdConfidence: 0.8 })).toMatchObject({
      phase: 'holding',
      holdDurationMs: 0,
      completedHoldCount: 0,
    });
    expect(machine.update({ timestampMs: 600, holdConfidence: 0.82 })).toMatchObject({
      phase: 'holding',
      holdDurationMs: 600,
      completedHoldCount: 0,
    });
    expect(machine.update({ timestampMs: 1000, holdConfidence: 0.82 })).toMatchObject({
      phase: 'completed',
      holdDurationMs: 1000,
      completedHoldCount: 1,
    });
  });

  it('breaks a hold when confidence falls below the exit threshold', () => {
    const machine = new HoldStateMachine({
      minHoldMs: 1000,
      enterConfidence: 0.75,
      exitConfidence: 0.55,
    });

    machine.update({ timestampMs: 0, holdConfidence: 0.8 });

    expect(machine.update({ timestampMs: 500, holdConfidence: 0.4 })).toMatchObject({
      phase: 'broken',
      holdDurationMs: 0,
      completedHoldCount: 0,
    });
  });

  it('rejects invalid configuration early', () => {
    expect(
      () =>
        new HoldStateMachine({
          minHoldMs: 0,
          enterConfidence: 0.75,
          exitConfidence: 0.55,
        }),
    ).toThrow(/minHoldMs/);
    expect(
      () =>
        new HoldStateMachine({
          minHoldMs: 1000,
          enterConfidence: 0.55,
          exitConfidence: 0.75,
        }),
    ).toThrow(/exitConfidence/);
  });
});
