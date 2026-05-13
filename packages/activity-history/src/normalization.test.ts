import { describe, expect, it } from 'vitest';

import { normalizeActivityHistory, normalizeActivitySessions } from './normalization.js';

describe('activity history normalization', () => {
  it('normalizes current and legacy movement collections', () => {
    const history = normalizeActivityHistory({
      sessions: [
        {
          id: 'session_1',
          startedAt: '2026-05-12T07:00:00.000Z',
          durationSeconds: 45,
          exercises: [
            {
              id: 'set_1',
              movementType: 'push_up',
              cameraAngle: 'side',
              startedAt: '2026-05-12T07:00:05.000Z',
              reps: 3,
              validReps: 2,
              partialReps: 1,
              formWarnings: [{ code: 'partial_depth', message: 'Lower farther.' }],
              repEvents: [
                {
                  repNumber: 1,
                  timestampMs: 1000,
                  qualityScore: 88,
                  depthScore: 1,
                  alignmentScore: 0.8,
                  warnings: [],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]?.movements[0]).toMatchObject({
      movementType: 'push_up',
      validReps: 2,
      partialReps: 1,
    });
  });

  it('drops malformed sessions and unsupported movement records', () => {
    expect(
      normalizeActivitySessions([
        { id: 'missing-date', movements: [] },
        {
          id: 'session_2',
          startedAt: '2026-05-12T07:00:00.000Z',
          movements: [
            {
              id: 'unknown',
              movementType: 'dance',
              cameraAngle: 'side',
              startedAt: '2026-05-12T07:00:05.000Z',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: 'session_2',
        startedAt: '2026-05-12T07:00:00.000Z',
        endedAt: undefined,
        durationSeconds: undefined,
        movements: [],
        notes: undefined,
      },
    ]);
  });
});
