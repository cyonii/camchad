import { describe, expect, it } from 'vitest';

import { CyclicPhaseMachine } from './cyclic-phase-machine.js';

describe('CyclicPhaseMachine', () => {
  it('tracks a complete top-bottom-top repetition', () => {
    const machine = new CyclicPhaseMachine({
      topThreshold: 150,
      bottomThreshold: 110,
      hysteresis: 8,
      minBottomHoldMs: 80,
    });

    expect(machine.update(sample(154, 0, false, false)).phase).toBe('top');
    expect(machine.update(sample(136, 100, true, false)).phase).toBe('descending');
    expect(machine.update(sample(108, 200, true, false)).phase).toBe('bottom');
    expect(machine.update(sample(125, 320, false, true)).phase).toBe('ascending');
    expect(machine.update(sample(154, 420, false, true))).toEqual({
      phase: 'top',
      completedRep: 'valid',
    });
  });

  it('records a partial repetition when the signal returns to top before bottom', () => {
    const machine = new CyclicPhaseMachine({
      topThreshold: 150,
      bottomThreshold: 110,
      hysteresis: 8,
      minBottomHoldMs: 80,
    });

    machine.update(sample(154, 0, false, false));
    machine.update(sample(136, 100, true, false));

    expect(machine.update(sample(154, 220, false, true))).toEqual({
      phase: 'top',
      completedRep: 'partial',
    });
  });

  it('respects bottom hold timing before allowing the return phase', () => {
    const machine = new CyclicPhaseMachine({
      topThreshold: 150,
      bottomThreshold: 110,
      hysteresis: 8,
      minBottomHoldMs: 120,
    });

    machine.update(sample(154, 0, false, false));
    machine.update(sample(136, 100, true, false));
    machine.update(sample(108, 200, true, false));

    expect(machine.update(sample(125, 260, false, true)).phase).toBe('bottom');
    expect(machine.update(sample(125, 340, false, true)).phase).toBe('ascending');
  });
});

function sample(
  signal: number,
  timestampMs: number,
  isDescendingSignal: boolean,
  isAscendingSignal: boolean,
) {
  return {
    signal,
    timestampMs,
    isDescendingSignal,
    isAscendingSignal,
  };
}
