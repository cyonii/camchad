import type { CameraAngle, FormWarning, MovementType, RepEvent } from '@camchad/movement-core';

import type { ActivitySession, MovementSegment } from './models.js';

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

  const movements = Array.isArray(value.movements)
    ? value.movements
    : Array.isArray(value.exercises)
      ? value.exercises
      : [];

  return [
    {
      id: value.id,
      startedAt: value.startedAt,
      endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
      durationSeconds:
        typeof value.durationSeconds === 'number' ? value.durationSeconds : undefined,
      movements: movements.flatMap((movement) => normalizeMovementSegment(movement)),
      notes: typeof value.notes === 'string' ? value.notes : undefined,
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
    value === 'yoga_hold'
  );
}

function isCameraAngle(value: unknown): value is CameraAngle {
  return value === 'side' || value === 'front' || value === 'front_diagonal';
}

function isFormWarningCode(value: unknown): value is FormWarning['code'] {
  return (
    value === 'tracking_lost' ||
    value === 'low_confidence' ||
    value === 'body_alignment' ||
    value === 'partial_depth' ||
    value === 'camera_angle_experimental'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
