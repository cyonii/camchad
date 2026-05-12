import type { WorkoutSession } from '@home-workout/workout-history';

export interface HistoryChartPoint {
  readonly sessionId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly validReps: number;
  readonly partialReps: number;
  readonly totalReps: number;
  readonly durationSeconds: number;
}

export interface HistoryChartModel {
  readonly points: readonly HistoryChartPoint[];
  readonly maxReps: number;
  readonly totalValidReps: number;
  readonly totalPartialReps: number;
}

export function buildHistoryChartModel(
  sessions: readonly WorkoutSession[],
  maxPoints = 12,
): HistoryChartModel {
  const points = [...sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-maxPoints)
    .map((session) => {
      const exercises = session.exercises;
      const validReps = exercises.reduce((sum, exercise) => sum + exercise.validReps, 0);
      const partialReps = exercises.reduce((sum, exercise) => sum + exercise.partialReps, 0);

      return {
        sessionId: session.id,
        label: compactDate(session.startedAt),
        startedAt: session.startedAt,
        validReps,
        partialReps,
        totalReps: validReps + partialReps,
        durationSeconds: session.durationSeconds ?? 0,
      };
    });

  return {
    points,
    maxReps: Math.max(1, ...points.map((point) => point.totalReps)),
    totalValidReps: points.reduce((sum, point) => sum + point.validReps, 0),
    totalPartialReps: points.reduce((sum, point) => sum + point.partialReps, 0),
  };
}

function compactDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
