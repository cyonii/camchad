import { describe, expect, it } from 'vitest';

import type { WorkoutSession } from '@home-workout/workout-history';

import { buildHistoryChartModel } from './history-chart.js';

describe('buildHistoryChartModel', () => {
  it('returns an empty model with a stable scale for no sessions', () => {
    const model = buildHistoryChartModel([], 12, new Date('2026-05-12T08:00:00.000Z'));

    expect(model).toEqual({
      points: expect.arrayContaining([
        expect.objectContaining({
          hasWorkout: false,
          totalReps: 0,
        }),
      ]),
      maxReps: 10,
      hasWorkouts: false,
      totalValidReps: 0,
      totalPartialReps: 0,
    });
    expect(model.points).toHaveLength(12);
  });

  it('aggregates sessions into calendar days with blank surrounding days', () => {
    const model = buildHistoryChartModel(
      [
        session('morning', '2026-05-12T08:00:00.000Z', 5, 1),
        session('evening', '2026-05-12T18:00:00.000Z', 3, 2),
      ],
      12,
      new Date('2026-05-12T08:00:00.000Z'),
    );

    const workoutPoint = model.points.find((point) => point.hasWorkout);

    expect(workoutPoint).toMatchObject({
      validReps: 8,
      partialReps: 3,
      totalReps: 11,
    });
    expect(model.points.some((point) => !point.hasWorkout)).toBe(true);
    expect(model.maxReps).toBe(20);
    expect(model.hasWorkouts).toBe(true);
    expect(model.totalValidReps).toBe(8);
    expect(model.totalPartialReps).toBe(3);
  });

  it('uses a minimum visual scale so tiny workouts do not fill the graph', () => {
    const model = buildHistoryChartModel(
      [session('tiny', '2026-05-12T08:00:00.000Z', 1, 0)],
      12,
      new Date('2026-05-12T08:00:00.000Z'),
    );

    expect(model.maxReps).toBe(10);
    expect(model.points.find((point) => point.hasWorkout)?.totalReps).toBe(1);
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
