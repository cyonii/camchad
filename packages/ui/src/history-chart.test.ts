import { describe, expect, it } from 'vitest';

import type { WorkoutSession } from '@home-workout/workout-history';

import { buildHistoryChartModel } from './history-chart.js';

describe('buildHistoryChartModel', () => {
  it('returns an empty model with a stable scale for no sessions', () => {
    expect(buildHistoryChartModel([])).toEqual({
      points: [],
      maxReps: 1,
      totalValidReps: 0,
      totalPartialReps: 0,
    });
  });

  it('sorts sessions chronologically and aggregates valid and partial reps', () => {
    const model = buildHistoryChartModel([
      session('late', '2026-05-12T08:00:00.000Z', 5, 1),
      session('early', '2026-05-10T08:00:00.000Z', 3, 2),
    ]);

    expect(model.points.map((point) => point.sessionId)).toEqual(['early', 'late']);
    expect(model.points.map((point) => point.totalReps)).toEqual([5, 6]);
    expect(model.maxReps).toBe(6);
    expect(model.totalValidReps).toBe(8);
    expect(model.totalPartialReps).toBe(3);
  });

  it('limits chart points to the most recent sessions', () => {
    const sessions = Array.from({ length: 14 }, (_, index) =>
      session(
        `session-${index}`,
        `2026-05-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
        index,
        0,
      ),
    );

    const model = buildHistoryChartModel(sessions, 12);

    expect(model.points).toHaveLength(12);
    expect(model.points[0]?.sessionId).toBe('session-2');
    expect(model.points.at(-1)?.sessionId).toBe('session-13');
  });
});

function session(
  id: string,
  startedAt: string,
  validReps: number,
  partialReps: number,
): WorkoutSession {
  return {
    id,
    startedAt,
    durationSeconds: 60,
    exercises: [
      {
        id: `set-${id}`,
        exerciseType: 'push_up',
        cameraAngle: 'side',
        startedAt,
        reps: validReps + partialReps,
        validReps,
        partialReps,
        formWarnings: [],
        repEvents: [],
      },
    ],
  };
}
