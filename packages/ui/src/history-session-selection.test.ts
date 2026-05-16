import { describe, expect, it } from 'vitest';

import type { ActivitySession } from '@camchad/activity-history';

import { selectedHistorySession } from './history-session-selection.js';

describe('selectedHistorySession', () => {
  it('defaults to the newest session', () => {
    expect(selectedHistorySession([session('newest'), session('older')], undefined)?.id).toBe(
      'newest',
    );
  });

  it('returns the requested session when it exists', () => {
    expect(selectedHistorySession([session('newest'), session('older')], 'older')?.id).toBe(
      'older',
    );
  });

  it('falls back to the newest session when the selection is stale', () => {
    expect(selectedHistorySession([session('newest'), session('older')], 'deleted')?.id).toBe(
      'newest',
    );
  });

  it('returns no session for an empty history', () => {
    expect(selectedHistorySession([], 'missing')).toBeUndefined();
  });
});

function session(id: string): ActivitySession {
  return {
    id,
    startedAt: '2026-05-16T08:00:00.000Z',
    durationSeconds: 120,
    movements: [],
    timeline: [],
  };
}
