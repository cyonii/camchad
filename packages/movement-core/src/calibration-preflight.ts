import type { ActivityStateSnapshot } from './activity-state-segmenter.js';
import type { MovementDiagnosticsSnapshot, MovementGuidanceEvent } from './movement-diagnostics.js';
import type { MovementWindowSnapshot } from './movement-window.js';

export type CalibrationPreflightStatus = 'waiting' | 'needs_adjustment' | 'ready';

export interface CalibrationPreflightSnapshot {
  readonly status: CalibrationPreflightStatus;
  readonly title: string;
  readonly message: string;
  readonly confidence: number;
  readonly blockingGuidance?: MovementGuidanceEvent;
}

export interface CalibrationPreflightInput {
  readonly activityState: ActivityStateSnapshot;
  readonly diagnostics: MovementDiagnosticsSnapshot;
  readonly window?: MovementWindowSnapshot;
}

const minimumReadyConfidence = 0.65;
const maximumReadyMissingRatio = 0.1;

export function evaluateCalibrationPreflight(
  input: CalibrationPreflightInput,
): CalibrationPreflightSnapshot {
  const blockingGuidance = input.diagnostics.events.find(
    (event) => event.severity === 'warning' && event.code !== 'conditions_usable',
  );

  if (blockingGuidance) {
    return {
      status: 'needs_adjustment',
      title: blockingGuidance.title,
      message: blockingGuidance.message,
      confidence: blockingGuidance.confidence,
      blockingGuidance,
    };
  }

  const missingSampleRatio = input.window?.missingSampleRatio ?? 1;
  const hasRecentBodySignal = input.window?.latestValid !== undefined;
  const hasStableSignal =
    input.activityState.state !== 'tracking_lost' &&
    input.activityState.confidence >= minimumReadyConfidence &&
    missingSampleRatio <= maximumReadyMissingRatio;

  if (hasRecentBodySignal && hasStableSignal) {
    return {
      status: 'ready',
      title: 'Calibration ready',
      message: 'Body visibility and signal quality are sufficient for movement analysis.',
      confidence: input.activityState.confidence,
    };
  }

  return {
    status: 'waiting',
    title: 'Calibrating view',
    message: hasRecentBodySignal
      ? 'Hold position briefly while the engine stabilizes body landmarks.'
      : 'Step fully into frame so the engine can establish body visibility.',
    confidence: input.activityState.confidence,
  };
}
