import { describe, expect, it } from 'vitest';

import type { ActivitySession, MovementSegment } from '@camchad/activity-history';

import { buildSessionFatigueModel } from './history-fatigue.js';

describe('buildSessionFatigueModel', () => {
  it('uses explicit movement fatigue telemetry when available', () => {
    const model = buildSessionFatigueModel(
      session([
        movement('set-1', 0.92, { fatigueScore: 0.12 }),
        movement('set-2', 0.9, { fatigueScore: 0.41 }),
      ]),
    );

    expect(model.points.map((point) => point.fatigueScore)).toEqual([0.12, 0.41]);
    expect(model.sessionFatigueScore).toBeCloseTo(0.265);
  });

  it('derives monotonic fatigue from synthetic confidence decay', () => {
    const model = buildSessionFatigueModel(
      session([movement('set-1', 0.94), movement('set-2', 0.82), movement('set-3', 0.68)]),
    );

    expect(model.points[0]?.fatigueScore).toBeLessThan(model.points[1]!.fatigueScore);
    expect(model.points[1]?.fatigueScore).toBeLessThan(model.points[2]!.fatigueScore);
  });

  it('adds warning and guidance pressure to derived fatigue', () => {
    const model = buildSessionFatigueModel(
      session([
        movement('set-1', 0.9),
        {
          ...movement('set-2', 0.9),
          formWarnings: [{ code: 'body_alignment', message: 'Keep your body line stable.' }],
          guidanceEvents: [
            {
              code: 'side_angle_recommended',
              title: 'Side angle recommended',
              message: 'Turn sideways for better tracking.',
              severity: 'info',
              confidence: 0.8,
            },
          ],
        },
      ]),
    );

    expect(model.points[1]?.fatigueScore).toBeGreaterThan(model.points[0]!.fatigueScore);
    expect(model.points[1]).toMatchObject({
      warningCount: 1,
      guidanceCount: 1,
    });
  });
});

function session(movements: readonly MovementSegment[]): ActivitySession {
  return {
    id: 'session-1',
    startedAt: '2026-05-16T08:00:00.000Z',
    durationSeconds: 180,
    timeline: [],
    movements,
  };
}

function movement(
  id: string,
  recognitionConfidence: number,
  telemetryMetrics?: Readonly<Record<string, number>>,
): MovementSegment {
  return {
    id,
    movementType: 'push_up',
    cameraAngle: 'side',
    startedAt: '2026-05-16T08:00:00.000Z',
    endedAt: '2026-05-16T08:01:00.000Z',
    reps: 8,
    validReps: 8,
    partialReps: 0,
    recognitionConfidence,
    telemetryMetrics,
    formWarnings: [],
    repEvents: [],
  };
}
