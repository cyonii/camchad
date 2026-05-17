import type { PoseFrame } from '@camchad/pose-core';

import type {
  MovementInterpreter,
  MovementInterpreterState,
  MovementType,
  CameraAngle,
} from './movement-interpreter.js';
import {
  createMovementProfileWindow,
  evaluateMovementProfileFrame,
  type MovementProfileEvaluationContext,
} from './movement-profile-evaluation-context.js';
import { evaluateMovementRecognitionCriteria } from './movement-profile-criteria.js';
import {
  createMovementInterpreterForDefinition,
  type MovementInterpreterFactoryOptions,
} from './movement-definition-interpreter.js';
import { movementRegistry, type MovementDefinition } from './movement-registry.js';
import { TemporalConfidenceAccumulator } from './temporal-confidence.js';

export interface MovementRecognitionEngineState {
  readonly primary: MovementInterpreterState;
  readonly candidates: readonly MovementInterpreterState[];
  readonly inference: MovementInferenceState;
}

export type MovementInferenceStatus = 'tracking_lost' | 'unknown' | 'ambiguous' | 'recognized';

export interface MovementInferenceState {
  readonly status: MovementInferenceStatus;
  readonly confidence: number;
  readonly primaryMovementType?: MovementType;
  readonly competingMovementTypes: readonly MovementType[];
  readonly evidence: readonly string[];
}

export interface MovementRecognitionEngineOptions {
  readonly cameraAngle?: CameraAngle;
  readonly definitions?: readonly MovementDefinition[];
}

const unknownConfidenceThreshold = 0.32;
const ambiguityConfidenceGap = 0.08;

export class MovementRecognitionEngine {
  private lastState: MovementRecognitionEngineState;
  private readonly candidateConfidence = new Map<MovementType, TemporalConfidenceAccumulator>();
  private readonly profileWindow = createMovementProfileWindow({ maxAgeMs: 1400 });
  private readonly definitionsByType: ReadonlyMap<MovementType, MovementDefinition>;

  public constructor(
    private readonly interpreters: readonly MovementInterpreter[],
    private readonly options: MovementRecognitionEngineOptions = {},
  ) {
    if (interpreters.length === 0) {
      throw new Error('MovementRecognitionEngine requires at least one movement interpreter.');
    }

    this.definitionsByType = new Map(
      (options.definitions ?? movementRegistry).map((definition) => [definition.type, definition]),
    );
    this.lastState = this.buildState(interpreters.map((interpreter) => interpreter.getState()));
  }

  public processPose(frame: PoseFrame | undefined): MovementRecognitionEngineState {
    const context = evaluateMovementProfileFrame({
      frame,
      window: this.profileWindow,
    });
    const candidates = this.interpreters.map((interpreter) =>
      this.stabilizeCandidate(this.applyProfileCriteria(interpreter.processPose(frame), context)),
    );
    this.lastState = this.buildState(candidates);

    return this.lastState;
  }

  public reset(): void {
    for (const interpreter of this.interpreters) {
      interpreter.reset();
    }

    this.candidateConfidence.clear();
    this.profileWindow.reset();
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
      inference: inferMovementState(primary, candidates),
    };
  }

  private applyProfileCriteria(
    state: MovementInterpreterState,
    context: MovementProfileEvaluationContext | undefined,
  ): MovementInterpreterState {
    const definition = this.definitionsByType.get(state.movementType);

    if (!context || !definition || state.recognition.status === 'tracking_lost') {
      return state;
    }

    const evaluation = evaluateMovementRecognitionCriteria({
      definition,
      context,
      cameraAngle: this.options.cameraAngle,
    });
    const blendedConfidence = evaluation.passed
      ? blendConfidence(state.recognition.confidence, evaluation.confidence, 0.18)
      : blendConfidence(state.recognition.confidence, evaluation.confidence, 0.1) * 0.82;

    return {
      ...state,
      recognition: {
        ...state.recognition,
        confidence: clamp01(blendedConfidence),
        evidence: [
          ...state.recognition.evidence,
          'profile_criteria_checked',
          ...evaluation.evidence.slice(0, 4),
        ],
      },
      metrics: {
        ...state.metrics,
        profileCriteriaConfidence: evaluation.confidence,
        profileCriteriaPassed: evaluation.passed ? 1 : 0,
      },
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

function inferMovementState(
  primary: MovementInterpreterState,
  candidates: readonly MovementInterpreterState[],
): MovementInferenceState {
  const rankedCandidates = [...candidates].sort(compareMovementCandidates);
  const runnerUp = rankedCandidates.find(
    (candidate) => candidate.movementType !== primary.movementType,
  );

  if (primary.recognition.status === 'tracking_lost') {
    return {
      status: 'tracking_lost',
      confidence: 0,
      competingMovementTypes: [],
      evidence: ['tracking_lost'],
    };
  }

  if (primary.recognition.confidence < unknownConfidenceThreshold) {
    return {
      status: 'unknown',
      confidence: primary.recognition.confidence,
      competingMovementTypes: rankedCandidates
        .filter((candidate) => candidate.recognition.confidence > 0)
        .slice(0, 3)
        .map((candidate) => candidate.movementType),
      evidence: ['insufficient_temporal_confidence'],
    };
  }

  if (
    runnerUp &&
    runnerUp.recognition.status !== 'tracking_lost' &&
    Math.abs(primary.recognition.confidence - runnerUp.recognition.confidence) <=
      ambiguityConfidenceGap
  ) {
    return {
      status: 'ambiguous',
      confidence: primary.recognition.confidence,
      primaryMovementType: primary.movementType,
      competingMovementTypes: [primary.movementType, runnerUp.movementType],
      evidence: ['similar_candidate_confidence'],
    };
  }

  return {
    status: 'recognized',
    confidence: primary.recognition.confidence,
    primaryMovementType: primary.movementType,
    competingMovementTypes: runnerUp ? [runnerUp.movementType] : [],
    evidence: primary.recognition.evidence,
  };
}

export function createMovementRecognitionEngine(
  options: MovementInterpreterFactoryOptions = {},
  definitions: readonly MovementDefinition[] = movementRegistry,
): MovementRecognitionEngine {
  return new MovementRecognitionEngine(
    definitions.flatMap((definition) => {
      const interpreter = createMovementInterpreterForDefinition(definition, options);

      return interpreter ? [interpreter] : [];
    }),
    {
      cameraAngle: options.cameraAngle,
      definitions,
    },
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

function blendConfidence(
  recognitionConfidence: number,
  criteriaConfidence: number,
  criteriaWeight: number,
): number {
  return recognitionConfidence * (1 - criteriaWeight) + criteriaConfidence * criteriaWeight;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
