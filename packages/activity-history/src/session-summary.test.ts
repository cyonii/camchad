import { describe, expect, it } from 'vitest';

import { summarizeActivitySession } from './session-summary.js';

import type { ActivitySession } from './models.js';

describe('summarizeActivitySession', () => {
  it('summarizes movement mix, rest periods, confidence trend, fatigue, and failure modes', () => {
    const summary = summarizeActivitySession({
      id: 'session_1',
      startedAt: '2026-05-12T07:00:00.000Z',
      movements: [
        {
          id: 'set_1',
          movementType: 'push_up',
          cameraAngle: 'side',
          startedAt: '2026-05-12T07:00:10.000Z',
          endedAt: '2026-05-12T07:00:40.000Z',
          reps: 8,
          validReps: 7,
          partialReps: 1,
          recognitionConfidence: 0.9,
          formWarnings: [{ code: 'partial_depth', message: 'Lower farther.' }],
          repEvents: [],
        },
        {
          id: 'set_2',
          movementType: 'squat',
          cameraAngle: 'side',
          startedAt: '2026-05-12T07:01:10.000Z',
          endedAt: '2026-05-12T07:01:50.000Z',
          reps: 10,
          validReps: 10,
          partialReps: 0,
          recognitionConfidence: 0.74,
          guidanceEvents: [
            {
              code: 'low_confidence',
              severity: 'warning',
              title: 'Signal confidence low',
              message: 'Improve lighting.',
              confidence: 0.4,
            },
          ],
          formWarnings: [],
          repEvents: [],
        },
      ],
      timeline: [
        {
          id: 'event_1',
          kind: 'session_start',
          timestamp: '2026-05-12T07:00:00.000Z',
        },
        { id: 'event_2', kind: 'rest', timestamp: '2026-05-12T07:00:50.000Z' },
      ],
    } satisfies ActivitySession);

    expect(summary.movementMix).toEqual([
      { movementType: 'squat', reps: 10, validReps: 10, durationSeconds: 40 },
      { movementType: 'push_up', reps: 8, validReps: 7, durationSeconds: 30 },
    ]);
    expect(summary.restPeriods).toBe(1);
    expect(summary.confidenceTrend).toBe('declining');
    expect(summary.fatigueScore).toBeGreaterThan(0);
    expect(summary.commonFailureModes).toEqual(['low_confidence', 'partial_depth']);
  });
});
