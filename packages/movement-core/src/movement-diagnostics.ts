import type { CameraAngle, MovementInterpreterState } from './movement-interpreter.js';
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
  | 'camera_too_close'
  | 'camera_too_far'
  | 'body_near_edge'
  | 'unstable_camera_distance'
  | 'frame_drift'
  | 'landmark_jitter'
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
  readonly cameraAngle?: CameraAngle;
  readonly cameraAdviceConfidence?: number;
}

export interface MovementDiagnosticsSnapshot {
  readonly events: readonly MovementGuidanceEvent[];
  readonly primary?: MovementGuidanceEvent;
}

export function diagnoseMovement(input: MovementDiagnosticsInput): MovementDiagnosticsSnapshot {
  const events = prioritizeGuidanceEvents(
    [...trackingEvents(input), ...interpreterEvents(input), conditionsUsableEvent(input)].filter(
      (event): event is MovementGuidanceEvent => event !== undefined,
    ),
  );

  return {
    events,
    primary: events[0],
  };
}

export function prioritizeGuidanceEvents(
  events: readonly MovementGuidanceEvent[],
): readonly MovementGuidanceEvent[] {
  return [...events].sort((a, b) => guidanceRank(a) - guidanceRank(b));
}

function guidanceRank(event: MovementGuidanceEvent): number {
  const baseRank = guidanceCodePriority[event.code] ?? 80;
  const severityAdjustment = event.severity === 'warning' ? 0 : 8;
  const confidenceAdjustment = Math.round((1 - event.confidence) * 4);

  return baseRank + severityAdjustment + confidenceAdjustment;
}

const guidanceCodePriority: Record<MovementGuidanceCode, number> = {
  tracking_lost: 10,
  recent_tracking_gap: 16,
  full_body_not_visible: 20,
  torso_occluded: 24,
  camera_too_low: 26,
  camera_too_close: 28,
  camera_too_far: 30,
  body_near_edge: 32,
  unstable_camera_distance: 36,
  frame_drift: 38,
  landmark_jitter: 40,
  hands_missing: 44,
  feet_missing: 46,
  side_angle_recommended: 50,
  front_angle_recommended: 50,
  orientation_mismatch: 54,
  low_confidence: 60,
  movement_uncertain: 70,
  conditions_usable: 100,
};

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

  if (latestBody && latestBody.environment.edgeProximityRisk > 0.6) {
    events.push({
      code: 'body_near_edge',
      severity: 'warning',
      title: 'Body near frame edge',
      message: 'Re-center or step back so joints do not leave the camera frame during movement.',
      confidence: latestBody.environment.edgeProximityRisk,
    });
  }

  if (
    latestBody &&
    (latestBody.environment.cameraDistance === 'too_close' ||
      latestBody.environment.cameraDistance === 'near')
  ) {
    events.push({
      code: 'camera_too_close',
      severity: latestBody.environment.cameraDistance === 'too_close' ? 'warning' : 'info',
      title: 'Camera too close',
      message: 'Step back slightly so the full movement range remains visible.',
      confidence: latestBody.environment.cameraDistance === 'too_close' ? 0.9 : 0.62,
    });
  }

  if (
    latestBody &&
    (latestBody.environment.cameraDistance === 'too_far' ||
      latestBody.environment.cameraDistance === 'far')
  ) {
    events.push({
      code: 'camera_too_far',
      severity: latestBody.environment.cameraDistance === 'too_far' ? 'warning' : 'info',
      title: 'Camera too far',
      message: 'Move closer or increase lighting so joint positions remain stable.',
      confidence: latestBody.environment.cameraDistance === 'too_far' ? 0.9 : 0.62,
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

  if (input.window && input.window.environment.scaleStability < 0.72) {
    events.push({
      code: 'unstable_camera_distance',
      severity: 'warning',
      title: 'Camera distance unstable',
      message: 'Keep your distance from the camera consistent before counting reps.',
      confidence: 1 - input.window.environment.scaleStability,
    });
  }

  if (input.window && input.window.environment.centerStability < 0.55) {
    events.push({
      code: 'frame_drift',
      severity: 'warning',
      title: 'Body drifting in frame',
      message: 'Stay centered so the engine can compare joint motion consistently over time.',
      confidence: 1 - input.window.environment.centerStability,
    });
  }

  if (input.window && input.window.environment.landmarkJitter > 0.08) {
    events.push({
      code: 'landmark_jitter',
      severity: 'warning',
      title: 'Tracking jitter detected',
      message: 'Improve lighting, reduce motion blur, or slow the movement until landmarks settle.',
      confidence: Math.min(1, input.window.environment.landmarkJitter / 0.2),
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

function interpreterEvents(input: MovementDiagnosticsInput): readonly MovementGuidanceEvent[] {
  const state = input.interpreterState;

  if (!state) {
    return [];
  }

  const events: MovementGuidanceEvent[] = [];

  if (state.recognition.evidence.includes('body_orientation_mismatch')) {
    const recommendedAngle = movementDefinitionFor(state.movementType).cameraGuidance
      .recommendedAngle;

    events.push(
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
    );
  }

  const candidateAdvice = candidateCameraAdviceEvent(input);
  if (candidateAdvice && !events.some((event) => event.code === candidateAdvice.code)) {
    events.push(candidateAdvice);
  }

  return events;
}

function candidateCameraAdviceEvent(
  input: MovementDiagnosticsInput,
): MovementGuidanceEvent | undefined {
  const state = input.interpreterState;

  if (!state?.recognition.movementType || !input.cameraAngle) {
    return undefined;
  }

  const confidenceFloor = input.cameraAdviceConfidence ?? 0.35;
  if (
    state.recognition.status === 'tracking_lost' ||
    state.recognition.confidence < confidenceFloor
  ) {
    return undefined;
  }

  const definition = movementDefinitionFor(state.recognition.movementType);
  const recommendedAngle = definition.cameraGuidance.recommendedAngle;

  if (input.cameraAngle === recommendedAngle) {
    return undefined;
  }

  const isSupportedAngle = definition.supportedCameraAngles.includes(input.cameraAngle);
  const angleLabel = recommendedAngle === 'front' ? 'front' : 'side';
  const title = `${recommendedAngle === 'front' ? 'Front' : 'Side'} angle recommended`;

  return {
    code: recommendedAngle === 'front' ? 'front_angle_recommended' : 'side_angle_recommended',
    severity: isSupportedAngle ? 'info' : 'warning',
    title,
    message: `${definition.label} is being recognized, but ${angleLabel} view is the strongest camera angle for validation.`,
    confidence: state.recognition.confidence,
  };
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
