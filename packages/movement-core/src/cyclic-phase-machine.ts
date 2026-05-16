import type { MovementPhase } from './movement-interpreter.js';

export interface CyclicPhaseMachineConfig {
  readonly topThreshold: number;
  readonly bottomThreshold: number;
  readonly hysteresis: number;
  readonly minBottomHoldMs: number;
}

export interface CyclicPhaseMachineInput {
  readonly signal: number;
  readonly timestampMs: number;
  readonly isDescendingSignal: boolean;
  readonly isAscendingSignal: boolean;
}

export type CompletedCyclicRep = 'valid' | 'partial';

export interface CyclicPhaseMachineTransition {
  readonly phase: MovementPhase;
  readonly completedRep?: CompletedCyclicRep;
  readonly bottomHoldMs?: number;
}

export class CyclicPhaseMachine {
  private currentPhase: MovementPhase = 'setup_needed';
  private bottomEnteredAt?: number;
  private latestBottomHoldMs = 0;

  public constructor(private readonly config: CyclicPhaseMachineConfig) {}

  public get phase(): MovementPhase {
    return this.currentPhase;
  }

  public get lastBottomHoldMs(): number {
    return this.latestBottomHoldMs;
  }

  public setPhase(phase: MovementPhase): void {
    this.currentPhase = phase;

    if (phase !== 'bottom') {
      this.bottomEnteredAt = undefined;
    }
  }

  public reset(): void {
    this.currentPhase = 'setup_needed';
    this.bottomEnteredAt = undefined;
    this.latestBottomHoldMs = 0;
  }

  public update(input: CyclicPhaseMachineInput): CyclicPhaseMachineTransition {
    const reachedBottom = input.signal <= this.config.bottomThreshold;
    const reachedTop = input.signal >= this.config.topThreshold;
    let completedRep: CompletedCyclicRep | undefined;
    let bottomHoldMs: number | undefined;

    switch (this.currentPhase) {
      case 'tracking_lost':
      case 'setup_needed':
      case 'invalid_form':
        this.currentPhase = reachedTop ? 'top' : 'setup_needed';
        break;

      case 'top':
        if (
          !reachedTop &&
          (input.isDescendingSignal ||
            input.signal <= this.config.topThreshold - this.config.hysteresis)
        ) {
          this.currentPhase = 'descending';
        }
        break;

      case 'descending':
        if (reachedBottom) {
          this.currentPhase = 'bottom';
          this.bottomEnteredAt = input.timestampMs;
        } else if (reachedTop && input.isAscendingSignal) {
          completedRep = 'partial';
          this.currentPhase = 'top';
          this.bottomEnteredAt = undefined;
        }
        break;

      case 'bottom':
        if (
          this.bottomEnteredAt !== undefined &&
          input.timestampMs - this.bottomEnteredAt < this.config.minBottomHoldMs
        ) {
          break;
        }

        if (
          !reachedBottom &&
          (input.isAscendingSignal ||
            input.signal >= this.config.bottomThreshold + this.config.hysteresis)
        ) {
          bottomHoldMs =
            this.bottomEnteredAt === undefined
              ? undefined
              : input.timestampMs - this.bottomEnteredAt;
          this.latestBottomHoldMs = bottomHoldMs ?? 0;
          this.currentPhase = 'ascending';
        }
        break;

      case 'ascending':
        if (reachedTop) {
          completedRep = 'valid';
          this.currentPhase = 'top';
          this.bottomEnteredAt = undefined;
        } else if (reachedBottom && input.isDescendingSignal) {
          this.currentPhase = 'bottom';
          this.bottomEnteredAt = input.timestampMs;
        }
        break;
    }

    return {
      phase: this.currentPhase,
      completedRep,
      ...(bottomHoldMs === undefined ? {} : { bottomHoldMs }),
    };
  }
}
