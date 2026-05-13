import type { ActivitySession } from '@camchad/activity-history';
import { movementDefinitionFor, type MovementType } from '@camchad/movement-core';

export interface HistoryMovementBreakdown {
  readonly movementType: MovementType;
  readonly label: string;
  readonly sets: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly totalReps: number;
  readonly durationSeconds: number;
  readonly averageQuality: number;
  readonly warningCount: number;
  readonly cameraAngles: readonly string[];
}

export interface HistoryChartPoint {
  readonly sessionId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly hasActivity: boolean;
  readonly validReps: number;
  readonly partialReps: number;
  readonly totalReps: number;
  readonly durationSeconds: number;
  readonly sessionCount: number;
  readonly setCount: number;
  readonly warningCount: number;
  readonly averageQuality: number;
  readonly movements: readonly HistoryMovementBreakdown[];
}

export interface HistoryChartModel {
  readonly points: readonly HistoryChartPoint[];
  readonly maxReps: number;
  readonly hasActivities: boolean;
  readonly totalValidReps: number;
  readonly totalPartialReps: number;
  readonly totalSets: number;
  readonly totalWarnings: number;
  readonly movementBreakdown: readonly HistoryMovementBreakdown[];
}

export function buildHistoryChartModel(
  sessions: readonly ActivitySession[],
  maxPoints = 12,
  referenceDate = new Date(),
): HistoryChartModel {
  const sessionsByDay = new Map<string, readonly ActivitySession[]>();

  for (const session of sessions) {
    const key = dayKey(new Date(session.startedAt));
    sessionsByDay.set(key, [...(sessionsByDay.get(key) ?? []), session]);
  }

  const daysBeforeReference = Math.floor(maxPoints * 0.65);
  const firstDay = startOfDay(referenceDate);
  firstDay.setDate(firstDay.getDate() - daysBeforeReference);

  const points = Array.from({ length: maxPoints }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    const key = dayKey(date);
    const daySessions = sessionsByDay.get(key) ?? [];
    const movements = daySessions.flatMap((session) => session.movements);
    const validReps = movements.reduce((sum, movement) => sum + movement.validReps, 0);
    const partialReps = movements.reduce((sum, movement) => sum + movement.partialReps, 0);
    const repEvents = movements.flatMap((movement) => movement.repEvents);
    const movementBreakdown = buildMovementBreakdown(movements);
    const averageQuality =
      repEvents.length === 0
        ? 0
        : Math.round(
            repEvents.reduce((sum, event) => sum + event.qualityScore, 0) / repEvents.length,
          );

    return {
      sessionId: `day-${key}`,
      label: compactDate(date.toISOString()),
      startedAt: date.toISOString(),
      hasActivity: daySessions.length > 0,
      validReps,
      partialReps,
      totalReps: validReps + partialReps,
      sessionCount: daySessions.length,
      setCount: movements.length,
      warningCount: movements.reduce((sum, movement) => sum + movement.formWarnings.length, 0),
      durationSeconds: daySessions.reduce(
        (sum, session) => sum + (session.durationSeconds ?? 0),
        0,
      ),
      averageQuality,
      movements: movementBreakdown,
    };
  });

  const maxObservedReps = Math.max(0, ...points.map((point) => point.totalReps));
  const movementBreakdown = buildMovementBreakdown(
    sessions.flatMap((session) => session.movements),
  );

  return {
    points,
    maxReps: niceRepCeiling(Math.max(10, maxObservedReps)),
    hasActivities: points.some((point) => point.hasActivity),
    totalValidReps: points.reduce((sum, point) => sum + point.validReps, 0),
    totalPartialReps: points.reduce((sum, point) => sum + point.partialReps, 0),
    totalSets: points.reduce((sum, point) => sum + point.setCount, 0),
    totalWarnings: points.reduce((sum, point) => sum + point.warningCount, 0),
    movementBreakdown,
  };
}

function buildMovementBreakdown(
  movements: readonly ActivitySession['movements'][number][],
): readonly HistoryMovementBreakdown[] {
  const byMovement = new Map<MovementType, ActivitySession['movements'][number][]>();

  for (const movement of movements) {
    byMovement.set(movement.movementType, [
      ...(byMovement.get(movement.movementType) ?? []),
      movement,
    ]);
  }

  return [...byMovement.entries()]
    .map(([movementType, movementGroup]) => {
      const repEvents = movementGroup.flatMap((movement) => movement.repEvents);
      const definition = movementDefinitionFor(movementType);

      return {
        movementType,
        label: definition.label,
        sets: movementGroup.length,
        validReps: movementGroup.reduce((sum, movement) => sum + movement.validReps, 0),
        partialReps: movementGroup.reduce((sum, movement) => sum + movement.partialReps, 0),
        totalReps: movementGroup.reduce((sum, movement) => sum + movement.reps, 0),
        durationSeconds: movementGroup.reduce(
          (sum, movement) => sum + movementDurationSeconds(movement),
          0,
        ),
        averageQuality:
          repEvents.length === 0
            ? 0
            : Math.round(
                repEvents.reduce((sum, event) => sum + event.qualityScore, 0) / repEvents.length,
              ),
        warningCount: movementGroup.reduce(
          (sum, movement) => sum + movement.formWarnings.length,
          0,
        ),
        cameraAngles: [...new Set(movementGroup.map((movement) => movement.cameraAngle))],
      };
    })
    .sort((a, b) => b.totalReps - a.totalReps || a.label.localeCompare(b.label));
}

function movementDurationSeconds(movement: ActivitySession['movements'][number]): number {
  if (!movement.endedAt) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      (new Date(movement.endedAt).getTime() - new Date(movement.startedAt).getTime()) / 1000,
    ),
  );
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function niceRepCeiling(value: number): number {
  if (value <= 10) {
    return 10;
  }

  if (value <= 20) {
    return 20;
  }

  return Math.ceil(value / 10) * 10;
}

function compactDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
