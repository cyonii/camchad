import type {
  ActivitySessionTelemetry,
  FormWarning,
  MovementInterpreterState,
} from '@camchad/movement-core';

export type CameraFrameTone =
  | 'standby'
  | 'acquiring'
  | 'candidate'
  | 'locked'
  | 'unstable'
  | 'warning'
  | 'success'
  | 'partial'
  | 'lost';

export type CameraFrameImpulse = 'rep_valid' | 'rep_partial' | 'posture_break' | 'tracking_lost';

export interface CameraFrameFeedback {
  readonly tone: CameraFrameTone;
  readonly intensity: number;
  readonly confidence: number;
  readonly label: string;
  readonly impulse?: CameraFrameImpulse;
}

export interface CameraFrameFeedbackInput {
  readonly isPreviewActive: boolean;
  readonly isStarting: boolean;
  readonly isTracking: boolean;
  readonly cameraError?: string;
  readonly detectorState: MovementInterpreterState;
  readonly sessionTelemetry: ActivitySessionTelemetry;
  readonly impulse?: CameraFrameImpulse;
}

const stableTrackingConfidence = 0.72;
const usableActivityConfidence = 0.65;

export function deriveCameraFrameFeedback(input: CameraFrameFeedbackInput): CameraFrameFeedback {
  const confidence = clamp01(
    Math.max(
      input.detectorState.recognition.confidence,
      input.sessionTelemetry.activityConfidence ?? 0,
      input.sessionTelemetry.recognitionConfidence,
      input.detectorState.metrics.poseConfidence ?? 0,
    ),
  );
  const intensity = Math.max(0.18, confidence);

  if (input.impulse) {
    return impulseFeedback(input.impulse, confidence);
  }

  if (input.cameraError) {
    return {
      tone: 'warning',
      intensity: 0.78,
      confidence,
      label: 'Camera needs attention',
    };
  }

  if (input.isStarting) {
    return {
      tone: 'acquiring',
      intensity: 0.58,
      confidence,
      label: 'Acquiring camera',
    };
  }

  if (!input.isPreviewActive || !input.isTracking) {
    return {
      tone: 'standby',
      intensity: 0.24,
      confidence,
      label: 'Standby',
    };
  }

  if (isTrackingLost(input)) {
    if (confidence < 0.08 && !input.sessionTelemetry.lastMovementAtMs) {
      return {
        tone: 'acquiring',
        intensity: 0.32,
        confidence,
        label: 'Awaiting body signal',
      };
    }

    return {
      tone: 'lost',
      intensity: 0.7,
      confidence,
      label: 'Tracking lost',
    };
  }

  if (
    hasPostureBreak(input.detectorState.warnings) ||
    input.detectorState.phase === 'invalid_form'
  ) {
    return {
      tone: 'warning',
      intensity: Math.max(0.68, intensity),
      confidence,
      label: 'Posture break',
    };
  }

  const primaryGuidance = input.sessionTelemetry.guidanceEvents?.[0];

  if (primaryGuidance?.severity === 'warning') {
    return {
      tone: isPositioningGuidance(primaryGuidance.code) ? 'warning' : 'unstable',
      intensity: Math.max(0.54, primaryGuidance.confidence),
      confidence,
      label: primaryGuidance.title,
    };
  }

  if (
    input.detectorState.recognition.status === 'active' &&
    confidence >= stableTrackingConfidence &&
    (input.sessionTelemetry.activityConfidence ?? confidence) >= usableActivityConfidence
  ) {
    return {
      tone: 'locked',
      intensity,
      confidence,
      label: 'Signal stable',
    };
  }

  if (input.detectorState.recognition.status === 'candidate') {
    return {
      tone: 'candidate',
      intensity: Math.max(0.36, intensity),
      confidence,
      label: 'Movement candidate',
    };
  }

  return {
    tone: 'acquiring',
    intensity: Math.max(0.3, intensity),
    confidence,
    label: 'Acquiring body signal',
  };
}

export function impulseForRep(
  rep: MovementInterpreterState['lastRep'],
): CameraFrameImpulse | undefined {
  if (!rep) {
    return undefined;
  }

  return rep.warnings.some(
    (warning) => warning.code === 'partial_depth' || warning.code === 'range_of_motion',
  )
    ? 'rep_partial'
    : 'rep_valid';
}

function impulseFeedback(impulse: CameraFrameImpulse, confidence: number): CameraFrameFeedback {
  if (impulse === 'rep_valid') {
    return {
      tone: 'success',
      intensity: 0.96,
      confidence,
      label: 'Rep confirmed',
      impulse,
    };
  }

  if (impulse === 'rep_partial') {
    return {
      tone: 'partial',
      intensity: 0.86,
      confidence,
      label: 'Partial rep',
      impulse,
    };
  }

  if (impulse === 'posture_break') {
    return {
      tone: 'warning',
      intensity: 0.88,
      confidence,
      label: 'Posture break',
      impulse,
    };
  }

  return {
    tone: 'lost',
    intensity: 0.82,
    confidence,
    label: 'Tracking lost',
    impulse,
  };
}

function isTrackingLost(input: CameraFrameFeedbackInput): boolean {
  return (
    input.detectorState.recognition.status === 'tracking_lost' ||
    input.detectorState.phase === 'tracking_lost' ||
    input.sessionTelemetry.activityState === 'tracking_lost'
  );
}

function hasPostureBreak(warnings: readonly FormWarning[]): boolean {
  return warnings.some(
    (warning) => warning.code === 'body_alignment' || warning.code === 'posture_alignment',
  );
}

function isPositioningGuidance(code: string): boolean {
  return (
    code === 'full_body_not_visible' ||
    code === 'camera_too_low' ||
    code === 'side_angle_recommended' ||
    code === 'front_angle_recommended' ||
    code === 'orientation_mismatch'
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
