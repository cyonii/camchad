import type {
  ActivityStateKind,
  CameraAngle,
  FormWarning,
  MovementGuidanceEvent,
  MovementType,
  RepEvent,
} from '@camchad/movement-core';

import type { ActivitySession, ActivityTimelineEvent, MovementSegment } from './models.js';

export const activityHistorySchemaVersion = 1;

export interface PersistedActivityHistory {
  readonly schemaVersion: typeof activityHistorySchemaVersion;
  readonly app: 'CamChad';
  readonly sessions: readonly ActivitySession[];
}

export interface ActivitySessionMergeSummary {
  readonly importedSessions: number;
  readonly addedSessions: number;
  readonly updatedSessions: number;
  readonly unchangedSessions: number;
  readonly totalSessions: number;
}

export interface ActivitySessionMergeResult {
  readonly sessions: readonly ActivitySession[];
  readonly summary: ActivitySessionMergeSummary;
}

export function persistedActivityHistory(
  sessions: readonly ActivitySession[],
): PersistedActivityHistory {
  return {
    schemaVersion: activityHistorySchemaVersion,
    app: 'CamChad',
    sessions,
  };
}

export function normalizeActivityHistory(value: unknown): PersistedActivityHistory {
  if (
    !isRecord(value) ||
    value.schemaVersion !== activityHistorySchemaVersion ||
    value.app !== 'CamChad' ||
    !Array.isArray(value.sessions)
  ) {
    return persistedActivityHistory([]);
  }

  return persistedActivityHistory(normalizeActivitySessions(value.sessions));
}

export function normalizeActivitySessions(value: unknown): readonly ActivitySession[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((session) => normalizeActivitySession(session));
}

export function mergeActivitySessions(
  existing: readonly ActivitySession[],
  incoming: readonly ActivitySession[],
): ActivitySessionMergeResult {
  const existingSessions = normalizeActivitySessions(existing);
  const incomingSessions = normalizeActivitySessions(incoming);
  const sessionsById = new Map<string, ActivitySession>();
  const importedSessionsById = new Map<string, ActivitySession>();

  for (const session of existingSessions) {
    const current = sessionsById.get(session.id);
    sessionsById.set(session.id, current ? selectPreferredSession(current, session) : session);
  }

  for (const session of incomingSessions) {
    const current = importedSessionsById.get(session.id);
    importedSessionsById.set(
      session.id,
      current ? selectPreferredSession(current, session) : session,
    );
  }

  let addedSessions = 0;
  let updatedSessions = 0;
  let unchangedSessions = 0;

  for (const importedSession of importedSessionsById.values()) {
    const existingSession = sessionsById.get(importedSession.id);

    if (!existingSession) {
      sessionsById.set(importedSession.id, importedSession);
      addedSessions += 1;
      continue;
    }

    const selectedSession = selectPreferredSession(existingSession, importedSession);
    sessionsById.set(importedSession.id, selectedSession);

    if (sessionsAreEquivalent(existingSession, importedSession)) {
      unchangedSessions += 1;
    } else if (selectedSession === importedSession) {
      updatedSessions += 1;
    } else {
      unchangedSessions += 1;
    }
  }

  const sessions = [...sessionsById.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );

  return {
    sessions,
    summary: {
      importedSessions: incomingSessions.length,
      addedSessions,
      updatedSessions,
      unchangedSessions,
      totalSessions: sessions.length,
    },
  };
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
      competingMovementTypes: Array.isArray(value.competingMovementTypes)
        ? value.competingMovementTypes.filter(isMovementType)
        : undefined,
      movementSegmentId:
        typeof value.movementSegmentId === 'string' ? value.movementSegmentId : undefined,
      activityState: isActivityState(value.activityState) ? value.activityState : undefined,
      recognitionConfidence:
        typeof value.recognitionConfidence === 'number'
          ? clamp01(value.recognitionConfidence)
          : undefined,
      message: typeof value.message === 'string' ? value.message : undefined,
      code: typeof value.code === 'string' ? value.code : undefined,
      repNumber: typeof value.repNumber === 'number' ? value.repNumber : undefined,
      qualityScore: typeof value.qualityScore === 'number' ? value.qualityScore : undefined,
      rangeScore: typeof value.rangeScore === 'number' ? value.rangeScore : undefined,
      alignmentScore: typeof value.alignmentScore === 'number' ? value.alignmentScore : undefined,
      rhythmScore: typeof value.rhythmScore === 'number' ? value.rhythmScore : undefined,
      confidenceScore:
        typeof value.confidenceScore === 'number' ? value.confidenceScore : undefined,
      trackingQualityScore:
        typeof value.trackingQualityScore === 'number' ? value.trackingQualityScore : undefined,
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
      setSummary: normalizeMovementSetSummary(value.setSummary),
    },
  ];
}

function normalizeMovementSetSummary(value: unknown): MovementSegment['setSummary'] | undefined {
  if (!isRecord(value) || !isRecord(value.warningCounts)) {
    return undefined;
  }

  return {
    averageConfidence:
      typeof value.averageConfidence === 'number' ? clamp01(value.averageConfidence) : undefined,
    minQualityScore:
      typeof value.minQualityScore === 'number' ? clampQuality(value.minQualityScore) : undefined,
    maxQualityScore:
      typeof value.maxQualityScore === 'number' ? clampQuality(value.maxQualityScore) : undefined,
    bestRepNumber: typeof value.bestRepNumber === 'number' ? value.bestRepNumber : undefined,
    worstRepNumber: typeof value.worstRepNumber === 'number' ? value.worstRepNumber : undefined,
    averageCadenceSeconds:
      typeof value.averageCadenceSeconds === 'number' ? value.averageCadenceSeconds : undefined,
    restBeforeSeconds:
      typeof value.restBeforeSeconds === 'number' ? value.restBeforeSeconds : undefined,
    restAfterSeconds:
      typeof value.restAfterSeconds === 'number' ? value.restAfterSeconds : undefined,
    warningCounts: normalizeWarningCounts(value.warningCounts),
  };
}

function normalizeWarningCounts(value: Record<string, unknown>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => {
      const [key, count] = entry;

      return key.length > 0 && typeof count === 'number' && Number.isFinite(count);
    }),
  );
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
    typeof value.rangeScore !== 'number' ||
    typeof value.alignmentScore !== 'number' ||
    typeof value.rhythmScore !== 'number' ||
    typeof value.confidenceScore !== 'number' ||
    typeof value.trackingQualityScore !== 'number'
  ) {
    return [];
  }

  return [
    {
      repNumber: value.repNumber,
      timestampMs: value.timestampMs,
      qualityScore: value.qualityScore,
      rangeScore: value.rangeScore,
      alignmentScore: value.alignmentScore,
      rhythmScore: value.rhythmScore,
      confidenceScore: value.confidenceScore,
      trackingQualityScore: value.trackingQualityScore,
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
    value === 'rest' ||
    value === 'transition' ||
    value === 'tracking_lost' ||
    value === 'tracking_recovered' ||
    value === 'movement_candidate' ||
    value === 'movement_ambiguous' ||
    value === 'camera_guidance' ||
    value === 'rep_valid' ||
    value === 'rep_partial' ||
    value === 'quality_warning'
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
    value === 'torso_occluded' ||
    value === 'hands_missing' ||
    value === 'feet_missing' ||
    value === 'camera_too_low' ||
    value === 'camera_too_close' ||
    value === 'camera_too_far' ||
    value === 'body_near_edge' ||
    value === 'unstable_camera_distance' ||
    value === 'frame_drift' ||
    value === 'landmark_jitter' ||
    value === 'side_angle_recommended' ||
    value === 'front_angle_recommended' ||
    value === 'low_confidence' ||
    value === 'recent_tracking_gap' ||
    value === 'orientation_mismatch' ||
    value === 'movement_uncertain' ||
    value === 'movement_setup_hint' ||
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
    value === 'hand_position' ||
    value === 'posture_alignment' ||
    value === 'lower_body_visibility' ||
    value === 'missed_alternation' ||
    value === 'partial_depth' ||
    value === 'range_of_motion' ||
    value === 'camera_angle_experimental'
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampQuality(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function selectPreferredSession(
  existing: ActivitySession,
  incoming: ActivitySession,
): ActivitySession {
  const existingScore = scoreSessionCompleteness(existing);
  const incomingScore = scoreSessionCompleteness(incoming);

  if (incomingScore > existingScore) {
    return incoming;
  }

  if (incomingScore < existingScore) {
    return existing;
  }

  if (sessionsAreEquivalent(existing, incoming)) {
    return existing;
  }

  return incoming;
}

function scoreSessionCompleteness(session: ActivitySession): number {
  const movementDetailScore = session.movements.reduce((score, movement) => {
    return (
      score +
      movement.repEvents.length * 100 +
      (movement.guidanceEvents?.length ?? 0) * 30 +
      movement.formWarnings.length * 30 +
      Object.keys(movement.telemetryMetrics ?? {}).length * 20 +
      movement.validReps * 10 +
      movement.partialReps * 5 +
      movement.reps * 2 +
      (movement.setSummary ? 15 : 0) +
      (movement.endedAt ? 5 : 0)
    );
  }, 0);

  return (
    session.movements.length * 1_000 +
    movementDetailScore +
    session.timeline.length * 50 +
    (session.durationSeconds ?? 0) +
    (session.endedAt ? 20 : 0) +
    (session.notes ? 10 : 0)
  );
}

function sessionsAreEquivalent(left: ActivitySession, right: ActivitySession): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
