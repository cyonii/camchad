import type {
  ActivitySession,
  ActivitySessionAnalysisSummary,
  ActivitySessionMovementMix,
  MovementSegment,
} from './models.js';

export function summarizeActivitySession(session: ActivitySession): ActivitySessionAnalysisSummary {
  return {
    movementMix: movementMixFor(session.movements),
    restPeriods: session.timeline.filter((event) => event.kind === 'rest').length,
    confidenceTrend: confidenceTrendFor(session.movements),
    fatigueScore: fatigueScoreFor(session.movements),
    commonFailureModes: commonFailureModesFor(session.movements),
  };
}

function movementMixFor(
  movements: readonly MovementSegment[],
): readonly ActivitySessionMovementMix[] {
  const mix = new Map<MovementSegment['movementType'], ActivitySessionMovementMix>();

  for (const movement of movements) {
    const existing = mix.get(movement.movementType);
    const nextDuration = movementDurationSeconds(movement);

    mix.set(movement.movementType, {
      movementType: movement.movementType,
      reps: (existing?.reps ?? 0) + movement.reps,
      validReps: (existing?.validReps ?? 0) + movement.validReps,
      durationSeconds: (existing?.durationSeconds ?? 0) + nextDuration,
    });
  }

  return [...mix.values()].sort((a, b) => b.reps - a.reps);
}

function confidenceTrendFor(
  movements: readonly MovementSegment[],
): ActivitySessionAnalysisSummary['confidenceTrend'] {
  const confidenceValues = movements
    .map((movement) => movement.recognitionConfidence)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));

  if (confidenceValues.length < 2) {
    return 'unknown';
  }

  const delta = confidenceValues.at(-1)! - confidenceValues[0]!;

  if (delta > 0.08) {
    return 'improving';
  }

  if (delta < -0.08) {
    return 'declining';
  }

  return 'stable';
}

function fatigueScoreFor(movements: readonly MovementSegment[]): number {
  if (movements.length === 0) {
    return 0;
  }

  const warningPressure = movements.reduce(
    (sum, movement) => sum + movement.formWarnings.length + (movement.guidanceEvents?.length ?? 0),
    0,
  );
  const confidenceValues = movements
    .map((movement) => movement.recognitionConfidence)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const confidenceDrop =
    confidenceValues.length < 2 ? 0 : Math.max(0, confidenceValues[0]! - confidenceValues.at(-1)!);

  return clamp01(warningPressure / Math.max(1, movements.length * 4) + confidenceDrop);
}

function commonFailureModesFor(movements: readonly MovementSegment[]): readonly string[] {
  const counts = new Map<string, number>();

  for (const movement of movements) {
    for (const warning of movement.formWarnings) {
      counts.set(warning.code, (counts.get(warning.code) ?? 0) + 1);
    }

    for (const event of movement.guidanceEvents ?? []) {
      counts.set(event.code, (counts.get(event.code) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([code]) => code);
}

function movementDurationSeconds(movement: MovementSegment): number {
  if (!movement.endedAt) {
    return 0;
  }

  const startedAt = new Date(movement.startedAt).getTime();
  const endedAt = new Date(movement.endedAt).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 0;
  }

  return Math.max(0, Math.round((endedAt - startedAt) / 1000));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
