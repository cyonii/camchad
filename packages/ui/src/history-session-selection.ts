import type { ActivitySession } from '@camchad/activity-history';

export function selectedHistorySession(
  sessions: readonly ActivitySession[],
  selectedSessionId: string | undefined,
): ActivitySession | undefined {
  if (sessions.length === 0) {
    return undefined;
  }

  if (!selectedSessionId) {
    return sessions[0];
  }

  return sessions.find((session) => session.id === selectedSessionId) ?? sessions[0];
}
