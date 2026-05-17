import type { PoseFrame } from '@camchad/pose-core';

import type { ActivityStateSnapshot } from './activity-state-segmenter.js';
import { extractBodyState, type BodyState } from './body-state.js';
import { diagnoseMovement, type MovementDiagnosticsSnapshot } from './movement-diagnostics.js';
import type { MovementInterpreterState } from './movement-interpreter.js';
import {
  MovementWindow,
  type MovementWindowSnapshot,
  type MovementWindowOptions,
} from './movement-window.js';

export interface MovementProfileEvaluationContext {
  readonly bodyState: BodyState;
  readonly window: MovementWindowSnapshot;
  readonly minVisibility: number;
  readonly diagnostics?: MovementDiagnosticsSnapshot;
}

export interface MovementProfileEvaluationInput {
  readonly frame: PoseFrame | undefined;
  readonly window: MovementWindow;
  readonly minVisibility?: number;
  readonly activityState?: ActivityStateSnapshot;
  readonly interpreterState?: MovementInterpreterState;
}

export function createMovementProfileWindow(
  options: MovementWindowOptions = { maxAgeMs: 1800 },
): MovementWindow {
  return new MovementWindow(options);
}

export function evaluateMovementProfileFrame(
  input: MovementProfileEvaluationInput,
): MovementProfileEvaluationContext | undefined {
  const minVisibility = input.minVisibility ?? 0.45;
  const bodyState = extractBodyState(input.frame);
  const window = bodyState
    ? input.window.add(bodyState)
    : input.frame
      ? input.window.addMissing(input.frame.timestampMs)
      : input.window.snapshot();

  if (!bodyState) {
    return undefined;
  }

  if (bodyState.coverage.regions.torso < minVisibility) {
    return undefined;
  }

  return {
    bodyState,
    window,
    minVisibility,
    diagnostics:
      input.activityState && input.interpreterState
        ? diagnoseMovement({
            activityState: input.activityState,
            window,
            interpreterState: input.interpreterState,
          })
        : undefined,
  };
}
