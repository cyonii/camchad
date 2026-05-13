import type { PoseFrame } from '@camchad/pose-core';

import type { MovementInterpreter, MovementInterpreterState } from './movement-interpreter.js';
import {
  movementRegistry,
  type MovementDefinition,
  type MovementInterpreterFactoryOptions,
} from './movement-registry.js';

export interface MovementRecognitionEngineState {
  readonly primary: MovementInterpreterState;
  readonly candidates: readonly MovementInterpreterState[];
}

export class MovementRecognitionEngine {
  private lastState: MovementRecognitionEngineState;

  public constructor(private readonly interpreters: readonly MovementInterpreter[]) {
    if (interpreters.length === 0) {
      throw new Error('MovementRecognitionEngine requires at least one movement interpreter.');
    }

    this.lastState = this.buildState(interpreters.map((interpreter) => interpreter.getState()));
  }

  public processPose(frame: PoseFrame | undefined): MovementRecognitionEngineState {
    const candidates = this.interpreters.map((interpreter) => interpreter.processPose(frame));
    this.lastState = this.buildState(candidates);

    return this.lastState;
  }

  public reset(): void {
    for (const interpreter of this.interpreters) {
      interpreter.reset();
    }

    this.lastState = this.buildState(
      this.interpreters.map((interpreter) => interpreter.getState()),
    );
  }

  public getState(): MovementRecognitionEngineState {
    return this.lastState;
  }

  private buildState(
    candidates: readonly MovementInterpreterState[],
  ): MovementRecognitionEngineState {
    const primary = [...candidates].sort(compareMovementCandidates)[0];

    if (!primary) {
      throw new Error('MovementRecognitionEngine requires at least one movement state.');
    }

    return {
      primary,
      candidates,
    };
  }
}

export function createMovementRecognitionEngine(
  options: MovementInterpreterFactoryOptions = {},
  definitions: readonly MovementDefinition[] = movementRegistry,
): MovementRecognitionEngine {
  return new MovementRecognitionEngine(
    definitions.map((definition) => definition.createInterpreter(options)),
  );
}

function compareMovementCandidates(
  a: MovementInterpreterState,
  b: MovementInterpreterState,
): number {
  return (
    recognitionRank(b) - recognitionRank(a) ||
    b.recognition.confidence - a.recognition.confidence ||
    b.validReps - a.validReps
  );
}

function recognitionRank(state: MovementInterpreterState): number {
  if (state.recognition.status === 'active') {
    return 2;
  }

  if (state.recognition.status === 'candidate') {
    return 1;
  }

  return 0;
}
