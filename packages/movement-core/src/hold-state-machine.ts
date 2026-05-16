export type HoldPhase = 'setup_needed' | 'holding' | 'broken' | 'completed';

export interface HoldStateMachineConfig {
  readonly minHoldMs: number;
  readonly enterConfidence: number;
  readonly exitConfidence: number;
}

export interface HoldStateMachineInput {
  readonly timestampMs: number;
  readonly holdConfidence: number;
}

export interface HoldStateMachineState {
  readonly phase: HoldPhase;
  readonly holdStartedAt?: number;
  readonly holdDurationMs: number;
  readonly completedHoldCount: number;
}

export class HoldStateMachine {
  private phase: HoldPhase = 'setup_needed';
  private holdStartedAt?: number;
  private holdDurationMs = 0;
  private completedHoldCount = 0;

  public constructor(private readonly config: HoldStateMachineConfig) {
    if (config.minHoldMs <= 0) {
      throw new Error('HoldStateMachine minHoldMs must be greater than zero.');
    }

    if (config.exitConfidence > config.enterConfidence) {
      throw new Error('HoldStateMachine exitConfidence must not exceed enterConfidence.');
    }
  }

  public update(input: HoldStateMachineInput): HoldStateMachineState {
    switch (this.phase) {
      case 'setup_needed':
      case 'broken':
      case 'completed':
        if (input.holdConfidence >= this.config.enterConfidence) {
          this.phase = 'holding';
          this.holdStartedAt = input.timestampMs;
          this.holdDurationMs = 0;
        }
        break;

      case 'holding':
        if (input.holdConfidence < this.config.exitConfidence) {
          this.phase = 'broken';
          this.holdStartedAt = undefined;
          this.holdDurationMs = 0;
          break;
        }

        this.holdDurationMs =
          this.holdStartedAt === undefined ? 0 : input.timestampMs - this.holdStartedAt;

        if (this.holdDurationMs >= this.config.minHoldMs) {
          this.phase = 'completed';
          this.completedHoldCount += 1;
          this.holdStartedAt = undefined;
        }
        break;
    }

    return this.getState();
  }

  public reset(): void {
    this.phase = 'setup_needed';
    this.holdStartedAt = undefined;
    this.holdDurationMs = 0;
    this.completedHoldCount = 0;
  }

  public getState(): HoldStateMachineState {
    return {
      phase: this.phase,
      holdStartedAt: this.holdStartedAt,
      holdDurationMs: this.holdDurationMs,
      completedHoldCount: this.completedHoldCount,
    };
  }
}
