import type { ActivitySession } from '@home-activity/activity-history';

export interface HistoryChartPoint {
  readonly sessionId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly hasActivity: boolean;
  readonly validReps: number;
  readonly partialReps: number;
  readonly totalReps: number;
  readonly durationSeconds: number;
}

export interface HistoryChartModel {
  readonly points: readonly HistoryChartPoint[];
  readonly maxReps: number;
  readonly hasActivities: boolean;
  readonly totalValidReps: number;
  readonly totalPartialReps: number;
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

    return {
      sessionId: `day-${key}`,
      label: compactDate(date.toISOString()),
      startedAt: date.toISOString(),
      hasActivity: daySessions.length > 0,
      validReps,
      partialReps,
      totalReps: validReps + partialReps,
      durationSeconds: daySessions.reduce(
        (sum, session) => sum + (session.durationSeconds ?? 0),
        0,
      ),
    };
  });

  const maxObservedReps = Math.max(0, ...points.map((point) => point.totalReps));

  return {
    points,
    maxReps: niceRepCeiling(Math.max(10, maxObservedReps)),
    hasActivities: points.some((point) => point.hasActivity),
    totalValidReps: points.reduce((sum, point) => sum + point.validReps, 0),
    totalPartialReps: points.reduce((sum, point) => sum + point.partialReps, 0),
  };
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
