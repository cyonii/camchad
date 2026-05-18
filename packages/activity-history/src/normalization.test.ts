import { describe, expect, it } from 'vitest';

import { normalizeActivityHistory, normalizeActivitySessions } from './normalization.js';

describe('activity history normalization', () => {
  it('normalizes movement collections', () => {
    const history = normalizeActivityHistory({
      sessions: [
        {
          id: 'session_1',
          startedAt: '2026-05-12T07:00:00.000Z',
          durationSeconds: 45,
          timeline: [
            {
              id: 'event_1',
              kind: 'movement_ambiguous',
              timestamp: '2026-05-12T07:00:30.000Z',
              movementType: 'squat',
              competingMovementTypes: ['squat', 'lunge', 'dance'],
              activityState: 'resting',
              recognitionConfidence: 0.4,
              message: 'Movement candidates are close.',
              code: 'similar_candidate_confidence',
            },
          ],
          movements: [
            {
              id: 'set_1',
              movementType: 'push_up',
              cameraAngle: 'side',
              startedAt: '2026-05-12T07:00:05.000Z',
              reps: 3,
              validReps: 2,
              partialReps: 1,
              activityState: 'moving',
              recognitionConfidence: 1.4,
              telemetryMetrics: {
                temporalMovementConfidence: 0.82,
                noisy: 'drop',
              },
              guidanceEvents: [
                {
                  code: 'low_confidence',
                  severity: 'warning',
                  title: 'Signal confidence low',
                  message: 'Improve lighting.',
                  confidence: 1.2,
                },
              ],
              formWarnings: [{ code: 'partial_depth', message: 'Lower farther.' }],
              repEvents: [
                {
                  repNumber: 1,
                  timestampMs: 1000,
                  qualityScore: 88,
                  rangeScore: 1,
                  alignmentScore: 0.8,
                  rhythmScore: 0.7,
                  confidenceScore: 0.9,
                  trackingQualityScore: 1,
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
      activityState: 'moving',
      recognitionConfidence: 1,
      telemetryMetrics: {
        temporalMovementConfidence: 0.82,
      },
      guidanceEvents: [
        {
          code: 'low_confidence',
          severity: 'warning',
          title: 'Signal confidence low',
          message: 'Improve lighting.',
          confidence: 1,
        },
      ],
    });
    expect(history.sessions[0]?.timeline).toEqual([
      {
        id: 'event_1',
        kind: 'movement_ambiguous',
        timestamp: '2026-05-12T07:00:30.000Z',
        movementType: 'squat',
        competingMovementTypes: ['squat', 'lunge'],
        movementSegmentId: undefined,
        activityState: 'resting',
        recognitionConfidence: 0.4,
        message: 'Movement candidates are close.',
        code: 'similar_candidate_confidence',
        repNumber: undefined,
        qualityScore: undefined,
        rangeScore: undefined,
        alignmentScore: undefined,
        rhythmScore: undefined,
        confidenceScore: undefined,
        trackingQualityScore: undefined,
      },
    ]);
  });

  it('drops malformed sessions and unsupported movement records', () => {
    expect(
      normalizeActivitySessions([
        { id: 'missing-date', movements: [] },
        {
          id: 'session_2',
          startedAt: '2026-05-12T07:00:00.000Z',
          timeline: [{ id: 'bad', kind: 'dance', timestamp: '2026-05-12T07:00:01.000Z' }],
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
        timeline: [],
        notes: undefined,
      },
    ]);
  });
});
