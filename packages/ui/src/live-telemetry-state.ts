import type { ActivitySessionTelemetry, MovementInterpreterState } from '@camchad/movement-core';

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

    return {
      label: hasWarnings ? 'Partial rep' : 'Valid rep recorded',
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
      label: 'Movement recognized',
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

function firstWarningMessage(state: MovementInterpreterState): string | undefined {
  return state.warnings[0]?.message ?? state.lastRep?.warnings[0]?.message;
}

function formatPhase(phase: string): string {
  return phase.replaceAll('_', ' ');
}
