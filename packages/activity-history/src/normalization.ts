import type {
  ActivityStateKind,
  CameraAngle,
  FormWarning,
  MovementGuidanceEvent,
  MovementType,
  RepEvent,
} from '@camchad/movement-core';

import type { ActivitySession, ActivityTimelineEvent, MovementSegment } from './models.js';

export interface PersistedActivityHistory {
  readonly sessions: readonly ActivitySession[];
}

export function normalizeActivityHistory(value: unknown): PersistedActivityHistory {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return { sessions: [] };
  }

  return {
    sessions: normalizeActivitySessions(value.sessions),
  };
}

export function normalizeActivitySessions(value: unknown): readonly ActivitySession[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((session) => normalizeActivitySession(session));
}

export function normalizeActivitySession(value: unknown): readonly ActivitySession[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.startedAt !== 'string') {
    return [];
  }

  const movements = Array.isArray(value.movements) ? value.movements : [];

  return [
    {
      id: value.id,
      startedAt: value.startedAt,
      endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
      durationSeconds:
        typeof value.durationSeconds === 'number' ? value.durationSeconds : undefined,
      movements: movements.flatMap((movement) => normalizeMovementSegment(movement)),
      timeline: Array.isArray(value.timeline)
        ? value.timeline.flatMap((event) => normalizeTimelineEvent(event))
        : [],
      notes: typeof value.notes === 'string' ? value.notes : undefined,
    },
  ];
}

function normalizeTimelineEvent(value: unknown): readonly ActivityTimelineEvent[] {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isTimelineEventKind(value.kind) ||
    typeof value.timestamp !== 'string'
  ) {
    return [];
  }

  return [
    {
      id: value.id,
      kind: value.kind,
      timestamp: value.timestamp,
      movementType: isMovementType(value.movementType) ? value.movementType : undefined,
      movementSegmentId:
        typeof value.movementSegmentId === 'string' ? value.movementSegmentId : undefined,
      activityState: isActivityState(value.activityState) ? value.activityState : undefined,
      recognitionConfidence:
        typeof value.recognitionConfidence === 'number'
          ? clamp01(value.recognitionConfidence)
          : undefined,
    },
  ];
}

export function normalizeMovementSegment(value: unknown): readonly MovementSegment[] {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isMovementType(value.movementType) ||
    !isCameraAngle(value.cameraAngle) ||
    typeof value.startedAt !== 'string'
  ) {
    return [];
  }

  return [
    {
      id: value.id,
      movementType: value.movementType,
      cameraAngle: value.cameraAngle,
      startedAt: value.startedAt,
      endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
      reps: typeof value.reps === 'number' ? value.reps : 0,
      validReps: typeof value.validReps === 'number' ? value.validReps : 0,
      partialReps: typeof value.partialReps === 'number' ? value.partialReps : 0,
      activityState: isActivityState(value.activityState) ? value.activityState : undefined,
      recognitionConfidence:
        typeof value.recognitionConfidence === 'number'
          ? clamp01(value.recognitionConfidence)
          : undefined,
      telemetryMetrics: isRecord(value.telemetryMetrics)
        ? normalizeTelemetryMetrics(value.telemetryMetrics)
        : undefined,
      guidanceEvents: Array.isArray(value.guidanceEvents)
        ? value.guidanceEvents.flatMap((event) => normalizeGuidanceEvent(event))
        : [],
      formWarnings: Array.isArray(value.formWarnings)
        ? value.formWarnings.flatMap((warning) => normalizeFormWarning(warning))
        : [],
      repEvents: Array.isArray(value.repEvents)
        ? value.repEvents.flatMap((event) => normalizeRepEvent(event))
        : [],
    },
  ];
}

function normalizeFormWarning(value: unknown): readonly FormWarning[] {
  if (!isRecord(value) || !isFormWarningCode(value.code) || typeof value.message !== 'string') {
    return [];
  }

  return [{ code: value.code, message: value.message }];
}

function normalizeRepEvent(value: unknown): readonly RepEvent[] {
  if (
    !isRecord(value) ||
    typeof value.repNumber !== 'number' ||
    typeof value.timestampMs !== 'number' ||
    typeof value.qualityScore !== 'number' ||
    typeof value.depthScore !== 'number' ||
    typeof value.alignmentScore !== 'number'
  ) {
    return [];
  }

  return [
    {
      repNumber: value.repNumber,
      timestampMs: value.timestampMs,
      qualityScore: value.qualityScore,
      depthScore: value.depthScore,
      alignmentScore: value.alignmentScore,
      warnings: Array.isArray(value.warnings)
        ? value.warnings.flatMap((warning) => normalizeFormWarning(warning))
        : [],
    },
  ];
}

function isMovementType(value: unknown): value is MovementType {
  return (
    value === 'push_up' ||
    value === 'squat' ||
    value === 'sit_up' ||
    value === 'lunge' ||
    value === 'jumping_jack' ||
    value === 'plank' ||
    value === 'pull_up' ||
    value === 'burpee' ||
    value === 'mountain_climber' ||
    value === 'high_knees' ||
    value === 'lateral_raise' ||
    value === 'yoga_hold' ||
    value === 'crunch' ||
    value === 'leg_raise' ||
    value === 'glute_bridge' ||
    value === 'wall_sit' ||
    value === 'calf_raise' ||
    value === 'step_up' ||
    value === 'tricep_dip' ||
    value === 'bicep_curl' ||
    value === 'shoulder_press' ||
    value === 'deadlift' ||
    value === 'bear_crawl' ||
    value === 'side_plank' ||
    value === 'bird_dog' ||
    value === 'superman_hold' ||
    value === 'russian_twist'
  );
}

function isActivityState(value: unknown): value is ActivityStateKind {
  return (
    value === 'idle' ||
    value === 'setup' ||
    value === 'moving' ||
    value === 'resting' ||
    value === 'tracking_lost' ||
    value === 'unknown'
  );
}

function isTimelineEventKind(value: unknown): value is ActivityTimelineEvent['kind'] {
  return (
    value === 'session_start' ||
    value === 'movement_start' ||
    value === 'movement_end' ||
    value === 'rest'
  );
}

function normalizeTelemetryMetrics(
  value: Record<string, unknown>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
}

function normalizeGuidanceEvent(value: unknown): readonly MovementGuidanceEvent[] {
  if (
    !isRecord(value) ||
    !isGuidanceCode(value.code) ||
    !isGuidanceSeverity(value.severity) ||
    typeof value.title !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.confidence !== 'number'
  ) {
    return [];
  }

  return [
    {
      code: value.code,
      severity: value.severity,
      title: value.title,
      message: value.message,
      confidence: clamp01(value.confidence),
    },
  ];
}

function isGuidanceCode(value: unknown): value is MovementGuidanceEvent['code'] {
  return (
    value === 'tracking_lost' ||
    value === 'full_body_not_visible' ||
    value === 'low_confidence' ||
    value === 'recent_tracking_gap' ||
    value === 'orientation_mismatch' ||
    value === 'movement_uncertain' ||
    value === 'conditions_usable'
  );
}

function isGuidanceSeverity(value: unknown): value is MovementGuidanceEvent['severity'] {
  return value === 'info' || value === 'warning';
}

function isCameraAngle(value: unknown): value is CameraAngle {
  return value === 'side' || value === 'front' || value === 'front_diagonal';
}

function isFormWarningCode(value: unknown): value is FormWarning['code'] {
  return (
    value === 'tracking_lost' ||
    value === 'low_confidence' ||
    value === 'body_alignment' ||
    value === 'posture_alignment' ||
    value === 'partial_depth' ||
    value === 'range_of_motion' ||
    value === 'camera_angle_experimental'
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
