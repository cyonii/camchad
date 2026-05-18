import { movementDefinitionFor } from '@camchad/movement-core';

import type {
  ActivitySessionTelemetry,
  MovementDefinition,
  MovementInterpreterState,
} from '@camchad/movement-core';

export interface LiveTelemetryState {
  readonly label: string;
  readonly detail: string;
}

export function liveTelemetryStateFor(
  state: MovementInterpreterState,
  telemetry: ActivitySessionTelemetry,
): LiveTelemetryState {
  if (
    state.stateKind === 'tracking_lost' ||
    state.phase === 'tracking_lost' ||
    state.recognition.status === 'tracking_lost'
  ) {
    return {
      label: 'Tracking interrupted',
      detail: 'Reacquiring body landmarks',
    };
  }

  if (telemetry.mode === 'idle') {
    return {
      label: 'Observing',
      detail: 'Standby',
    };
  }

  if (telemetry.mode === 'resting' || state.stateKind === 'rest') {
    return {
      label: 'Resting',
      detail: telemetry.movementType ? 'Movement paused' : 'No active movement',
    };
  }

  if (state.lastRep && state.phase === 'top') {
    const hasWarnings = state.lastRep.warnings.length > 0;
    const definition = movementDefinitionFor(state.movementType);

    return {
      label: hasWarnings ? 'Partial rep' : completedRepLabel(definition),
      detail: `Rep ${state.lastRep.repNumber}`,
    };
  }

  if (state.stateKind === 'partial_rep') {
    return {
      label: 'Partial rep',
      detail: 'Range needs review',
    };
  }

  if (state.stateKind === 'failed_rep') {
    return {
      label: 'Form issue',
      detail: firstWarningMessage(state) ?? 'Movement quality below threshold',
    };
  }

  if (state.stateKind === 'active_rep') {
    return {
      label: 'Tracking movement',
      detail: formatPhase(state.phase),
    };
  }

  if (state.recognition.status === 'active') {
    return {
      label: 'Pattern recognized',
      detail: formatPhase(state.phase),
    };
  }

  if (state.recognition.status === 'candidate') {
    return {
      label: 'Movement candidate',
      detail: 'Accumulating confidence',
    };
  }

  return {
    label: 'Preparing',
    detail: state.stateKind === 'setup' ? 'Setup posture detected' : formatPhase(state.phase),
  };
}

function completedRepLabel(definition: MovementDefinition): string {
  if (definition.maturity === 'rep_validating' || definition.maturity === 'quality_validating') {
    return 'Validated rep';
  }

  return 'Rep counted';
}

function firstWarningMessage(state: MovementInterpreterState): string | undefined {
  return state.warnings[0]?.message ?? state.lastRep?.warnings[0]?.message;
}

function formatPhase(phase: string): string {
  return phase.replaceAll('_', ' ');
}
