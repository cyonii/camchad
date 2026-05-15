import type { PoseFrame } from '@camchad/pose-core';

import type {
  MovementInterpreter,
  MovementInterpreterState,
  MovementType,
} from './movement-interpreter.js';
import {
  movementRegistry,
  type MovementDefinition,
  type MovementInterpreterFactoryOptions,
} from './movement-registry.js';
import { TemporalConfidenceAccumulator } from './temporal-confidence.js';

export interface MovementRecognitionEngineState {
  readonly primary: MovementInterpreterState;
  readonly candidates: readonly MovementInterpreterState[];
}

export class MovementRecognitionEngine {
  private lastState: MovementRecognitionEngineState;
  private readonly candidateConfidence = new Map<MovementType, TemporalConfidenceAccumulator>();

  public constructor(private readonly interpreters: readonly MovementInterpreter[]) {
    if (interpreters.length === 0) {
      throw new Error('MovementRecognitionEngine requires at least one movement interpreter.');
    }

    this.lastState = this.buildState(interpreters.map((interpreter) => interpreter.getState()));
  }

  public processPose(frame: PoseFrame | undefined): MovementRecognitionEngineState {
    const candidates = this.interpreters.map((interpreter) =>
      this.stabilizeCandidate(interpreter.processPose(frame)),
    );
    this.lastState = this.buildState(candidates);

    return this.lastState;
  }

  public reset(): void {
    for (const interpreter of this.interpreters) {
      interpreter.reset();
    }

    this.candidateConfidence.clear();
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

  private stabilizeCandidate(state: MovementInterpreterState): MovementInterpreterState {
    const confidence = this.confidenceFor(state.movementType);
    const rawConfidence =
      state.recognition.status === 'tracking_lost' ? 0 : state.recognition.confidence;
    const snapshot = confidence.addSample(rawConfidence);
    const status =
      state.recognition.status === 'tracking_lost'
        ? 'tracking_lost'
        : snapshot.state === 'active' && state.recognition.status === 'active'
          ? 'active'
          : 'candidate';

    return {
      ...state,
      recognition: {
        ...state.recognition,
        confidence: snapshot.confidence,
        status,
        evidence:
          snapshot.sampleCount > 1
            ? [...state.recognition.evidence, 'temporal_candidate_confidence']
            : state.recognition.evidence,
      },
      metrics: {
        ...state.metrics,
        temporalCandidateConfidence: snapshot.confidence,
      },
    };
  }

  private confidenceFor(movementType: MovementType): TemporalConfidenceAccumulator {
    const existing = this.candidateConfidence.get(movementType);

    if (existing) {
      return existing;
    }

    const created = new TemporalConfidenceAccumulator({
      activationThreshold: 0.68,
      deactivationThreshold: 0.38,
      candidateThreshold: 0.44,
      riseAlpha: 0.55,
      fallAlpha: 0.5,
    });

    this.candidateConfidence.set(movementType, created);
    return created;
  }
}

export function createMovementRecognitionEngine(
  options: MovementInterpreterFactoryOptions = {},
  definitions: readonly MovementDefinition[] = movementRegistry,
): MovementRecognitionEngine {
  return new MovementRecognitionEngine(
    definitions.flatMap((definition) =>
      definition.createInterpreter ? [definition.createInterpreter(options)] : [],
    ),
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
