import type { MovementInterpreterState } from './movement-interpreter.js';
import type { ActivityStateSnapshot } from './activity-state-segmenter.js';
import type { MovementWindowSnapshot } from './movement-window.js';
import { movementDefinitionFor } from './movement-registry.js';

export type MovementGuidanceCode =
  | 'tracking_lost'
  | 'full_body_not_visible'
  | 'torso_occluded'
  | 'hands_missing'
  | 'feet_missing'
  | 'camera_too_low'
  | 'side_angle_recommended'
  | 'front_angle_recommended'
  | 'low_confidence'
  | 'recent_tracking_gap'
  | 'orientation_mismatch'
  | 'movement_uncertain'
  | 'conditions_usable';

export interface MovementGuidanceEvent {
  readonly code: MovementGuidanceCode;
  readonly severity: 'info' | 'warning';
  readonly title: string;
  readonly message: string;
  readonly confidence: number;
}

export interface MovementDiagnosticsInput {
  readonly activityState: ActivityStateSnapshot;
  readonly window?: MovementWindowSnapshot;
  readonly interpreterState?: MovementInterpreterState;
}

export interface MovementDiagnosticsSnapshot {
  readonly events: readonly MovementGuidanceEvent[];
  readonly primary?: MovementGuidanceEvent;
}

export function diagnoseMovement(input: MovementDiagnosticsInput): MovementDiagnosticsSnapshot {
  const events = [
    ...trackingEvents(input),
    ...interpreterEvents(input.interpreterState),
    conditionsUsableEvent(input),
  ].filter((event): event is MovementGuidanceEvent => event !== undefined);

  return {
    events,
    primary: events[0],
  };
}

function trackingEvents(input: MovementDiagnosticsInput): readonly MovementGuidanceEvent[] {
  const events: MovementGuidanceEvent[] = [];
  const latestBody = input.window?.latestValid?.bodyState;

  if (input.activityState.state === 'tracking_lost') {
    events.push({
      code: 'tracking_lost',
      severity: 'warning',
      title: 'Tracking interrupted',
      message: 'Move fully into frame and keep the camera view clear.',
      confidence: 1 - input.activityState.confidence,
    });
  }

  if (latestBody && latestBody.coverage.fullBody < 0.55) {
    events.push({
      code: 'full_body_not_visible',
      severity: 'warning',
      title: 'Full body not visible',
      message: 'Step back or adjust the camera so the required joints stay in view.',
      confidence: 1 - latestBody.coverage.fullBody,
    });
  }

  if (latestBody && latestBody.environment.lowConfidenceRegions.includes('torso')) {
    events.push({
      code: 'torso_occluded',
      severity: 'warning',
      title: 'Torso partially occluded',
      message: 'Keep shoulders and hips visible so posture and body orientation stay reliable.',
      confidence: 1 - latestBody.coverage.regions.torso,
    });
  }

  if (
    latestBody &&
    (latestBody.environment.lowConfidenceRegions.includes('leftHand') ||
      latestBody.environment.lowConfidenceRegions.includes('rightHand'))
  ) {
    events.push({
      code: 'hands_missing',
      severity: 'info',
      title: 'Hands not clearly visible',
      message:
        'Hand visibility is limited. Large-body movements still work, but hand-aware analysis will be less reliable.',
      confidence: Math.max(
        1 - latestBody.coverage.regions.leftHand,
        1 - latestBody.coverage.regions.rightHand,
      ),
    });
  }

  if (latestBody && latestBody.coverage.upperBody >= 0.65 && latestBody.coverage.lowerBody < 0.45) {
    events.push({
      code: 'camera_too_low',
      severity: 'warning',
      title: 'Lower-body framing limited',
      message: 'Step back or raise the camera until hips, knees, ankles, and feet remain visible.',
      confidence: 1 - latestBody.coverage.lowerBody,
    });
  }

  if (
    latestBody &&
    (latestBody.environment.lowConfidenceRegions.includes('leftFoot') ||
      latestBody.environment.lowConfidenceRegions.includes('rightFoot'))
  ) {
    events.push({
      code: 'feet_missing',
      severity: 'info',
      title: 'Feet not clearly visible',
      message:
        'Step back if the movement requires foot placement, stance width, or lower-body stability.',
      confidence: Math.max(
        1 - latestBody.coverage.regions.leftFoot,
        1 - latestBody.coverage.regions.rightFoot,
      ),
    });
  }

  if (input.window && input.window.missingSampleRatio > 0.25) {
    events.push({
      code: 'recent_tracking_gap',
      severity: 'warning',
      title: 'Tracking gaps detected',
      message: 'Reduce occlusion, improve lighting, or slow down until tracking stabilizes.',
      confidence: input.window.missingSampleRatio,
    });
  }

  if (input.activityState.confidence > 0 && input.activityState.confidence < 0.5) {
    events.push({
      code: 'low_confidence',
      severity: 'warning',
      title: 'Signal confidence low',
      message: 'Improve lighting and keep the body silhouette clear against the background.',
      confidence: 1 - input.activityState.confidence,
    });
  }

  if (
    input.activityState.state === 'unknown' ||
    (input.activityState.state === 'setup' && input.activityState.motionMagnitude > 0.2)
  ) {
    events.push({
      code: 'movement_uncertain',
      severity: 'info',
      title: 'Movement not stable yet',
      message: 'Continue moving through a clear range so the engine can classify the pattern.',
      confidence: Math.min(1, input.activityState.motionMagnitude),
    });
  }

  return events;
}

function interpreterEvents(
  state: MovementInterpreterState | undefined,
): readonly MovementGuidanceEvent[] {
  if (!state) {
    return [];
  }

  if (state.recognition.evidence.includes('body_orientation_mismatch')) {
    const recommendedAngle = movementDefinitionFor(state.movementType).cameraGuidance
      .recommendedAngle;

    return [
      {
        code: recommendedAngle === 'front' ? 'front_angle_recommended' : 'side_angle_recommended',
        severity: 'warning',
        title: recommendedAngle === 'front' ? 'Front angle recommended' : 'Side angle recommended',
        message:
          recommendedAngle === 'front'
            ? 'Move the camera toward a front view for this movement pattern.'
            : 'Move the camera toward a side view for this movement pattern.',
        confidence: 1 - state.recognition.confidence,
      },
      {
        code: 'orientation_mismatch',
        severity: 'warning',
        title: 'Camera angle mismatch',
        message: 'Adjust your camera position for this movement pattern.',
        confidence: 1 - state.recognition.confidence,
      },
    ];
  }

  return [];
}

function conditionsUsableEvent(input: MovementDiagnosticsInput): MovementGuidanceEvent | undefined {
  if (
    input.activityState.state === 'tracking_lost' ||
    input.activityState.confidence < 0.65 ||
    (input.window?.missingSampleRatio ?? 0) > 0.1
  ) {
    return undefined;
  }

  return {
    code: 'conditions_usable',
    severity: 'info',
    title: 'Tracking conditions usable',
    message: 'Body visibility and signal quality are sufficient for movement analysis.',
    confidence: input.activityState.confidence,
  };
}
