import { describe, expect, it } from 'vitest';

import type { ActivitySession } from '@camchad/activity-history';

import { buildHistoryChartModel } from './history-chart.js';

describe('buildHistoryChartModel', () => {
  it('returns an empty model with a stable scale for no sessions', () => {
    const model = buildHistoryChartModel([], 12, new Date('2026-05-12T08:00:00.000Z'));

    expect(model).toEqual({
      points: expect.arrayContaining([
        expect.objectContaining({
          hasActivity: false,
          totalReps: 0,
        }),
      ]),
      maxReps: 10,
      hasActivities: false,
      totalValidReps: 0,
      totalPartialReps: 0,
      totalSets: 0,
      totalWarnings: 0,
      movementBreakdown: [],
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

    const activityPoint = model.points.find((point) => point.hasActivity);

    expect(activityPoint).toMatchObject({
      validReps: 8,
      partialReps: 3,
      totalReps: 11,
      sessionCount: 2,
      setCount: 2,
      averageQuality: 88,
      movements: [
        expect.objectContaining({
          label: 'Push-up',
          sets: 2,
          validReps: 8,
          partialReps: 3,
          totalReps: 11,
          cameraAngles: ['side'],
        }),
      ],
    });
    expect(model.points.some((point) => !point.hasActivity)).toBe(true);
    expect(model.maxReps).toBe(20);
    expect(model.hasActivities).toBe(true);
    expect(model.totalValidReps).toBe(8);
    expect(model.totalPartialReps).toBe(3);
    expect(model.totalSets).toBe(2);
    expect(model.movementBreakdown).toEqual([
      expect.objectContaining({
        movementType: 'push_up',
        sets: 2,
        totalReps: 11,
      }),
    ]);
  });

  it('uses a minimum visual scale so tiny activities do not fill the graph', () => {
    const model = buildHistoryChartModel(
      [session('tiny', '2026-05-12T08:00:00.000Z', 1, 0)],
      12,
      new Date('2026-05-12T08:00:00.000Z'),
    );

    expect(model.maxReps).toBe(10);
    expect(model.points.find((point) => point.hasActivity)?.totalReps).toBe(1);
  });
});

function session(
  id: string,
  startedAt: string,
  validReps: number,
  partialReps: number,
): ActivitySession {
  return {
    id,
    startedAt,
    durationSeconds: 60,
    movements: [
      {
        id: `set-${id}`,
        movementType: 'push_up',
        cameraAngle: 'side',
        startedAt,
        reps: validReps + partialReps,
        validReps,
        partialReps,
        formWarnings: [],
        repEvents: Array.from({ length: validReps }, (_, index) => ({
          repNumber: index + 1,
          timestampMs: (index + 1) * 1000,
          qualityScore: index % 2 === 0 ? 90 : 85,
          depthScore: 1,
          alignmentScore: 0.9,
          warnings: [],
        })),
      },
    ],
  };
}
