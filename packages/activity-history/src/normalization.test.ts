import { describe, expect, it } from 'vitest';

import {
  mergeActivitySessions,
  normalizeActivityHistory,
  normalizeActivitySessions,
} from './normalization.js';
import type { ActivitySession } from './models.js';

describe('activity history normalization', () => {
  it('normalizes movement collections', () => {
    const history = normalizeActivityHistory({
      schemaVersion: 1,
      app: 'CamChad',
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
              setSummary: {
                averageConfidence: 1.4,
                minQualityScore: -2,
                maxQualityScore: 104,
                bestRepNumber: 1,
                worstRepNumber: 1,
                averageCadenceSeconds: 12.5,
                restBeforeSeconds: 8,
                restAfterSeconds: 20,
                warningCounts: {
                  partial_depth: 2,
                  bad: 'drop',
                },
              },
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
      setSummary: {
        averageConfidence: 1,
        minQualityScore: 0,
        maxQualityScore: 100,
        bestRepNumber: 1,
        worstRepNumber: 1,
        averageCadenceSeconds: 12.5,
        restBeforeSeconds: 8,
        restAfterSeconds: 20,
        warningCounts: {
          partial_depth: 2,
        },
      },
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

  it('rejects unsupported activity history backup shapes', () => {
    expect(normalizeActivityHistory([{ id: 'legacy-array' }])).toEqual({
      schemaVersion: 1,
      app: 'CamChad',
      sessions: [],
    });
    expect(normalizeActivityHistory({ schemaVersion: 999, app: 'CamChad', sessions: [] })).toEqual({
      schemaVersion: 1,
      app: 'CamChad',
      sessions: [],
    });
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

  it('merges imported sessions into existing history without replacing local data', () => {
    const result = mergeActivitySessions(
      [
        sessionFixture({
          id: 'existing',
          startedAt: '2026-05-12T07:00:00.000Z',
          movementId: 'movement_existing',
          validReps: 6,
        }),
      ],
      [
        sessionFixture({
          id: 'imported',
          startedAt: '2026-05-13T07:00:00.000Z',
          movementId: 'movement_imported',
          validReps: 10,
        }),
      ],
    );

    expect(result.summary).toEqual({
      importedSessions: 1,
      addedSessions: 1,
      updatedSessions: 0,
      unchangedSessions: 0,
      totalSessions: 2,
    });
    expect(result.sessions.map((session) => session.id)).toEqual(['imported', 'existing']);
  });

  it('keeps the richer record when imported history overlaps an existing session', () => {
    const result = mergeActivitySessions(
      [
        sessionFixture({
          id: 'same',
          startedAt: '2026-05-12T07:00:00.000Z',
          movementId: 'movement_local',
          validReps: 4,
          repEventCount: 1,
        }),
      ],
      [
        sessionFixture({
          id: 'same',
          startedAt: '2026-05-12T07:00:00.000Z',
          movementId: 'movement_imported',
          validReps: 8,
          repEventCount: 4,
        }),
      ],
    );

    expect(result.summary).toEqual({
      importedSessions: 1,
      addedSessions: 0,
      updatedSessions: 1,
      unchangedSessions: 0,
      totalSessions: 1,
    });
    expect(result.sessions[0]?.movements[0]?.id).toBe('movement_imported');
    expect(result.sessions[0]?.movements[0]?.validReps).toBe(8);
    expect(result.sessions[0]?.movements[0]?.repEvents).toHaveLength(4);
  });
});

function sessionFixture(options: {
  readonly id: string;
  readonly startedAt: string;
  readonly movementId: string;
  readonly validReps: number;
  readonly repEventCount?: number;
}): ActivitySession {
  const session = {
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.startedAt,
    durationSeconds: 60,
    timeline: [],
    movements: [
      {
        id: options.movementId,
        movementType: 'squat',
        cameraAngle: 'front',
        startedAt: options.startedAt,
        endedAt: options.startedAt,
        reps: options.validReps,
        validReps: options.validReps,
        partialReps: 0,
        formWarnings: [],
        repEvents: Array.from({ length: options.repEventCount ?? 0 }, (_value, index) => ({
          repNumber: index + 1,
          timestampMs: index * 1_000,
          qualityScore: 90,
          rangeScore: 0.9,
          alignmentScore: 0.9,
          rhythmScore: 0.9,
          confidenceScore: 0.9,
          trackingQualityScore: 0.9,
          warnings: [],
        })),
      },
    ],
  };

  return normalizeActivitySessions([session])[0] as ActivitySession;
}
