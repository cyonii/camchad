import type { ActivitySession, ActivitySummary } from './models.js';

export interface ActivityRepository {
  listSessions(): Promise<readonly ActivitySession[]>;
  getSession(id: string): Promise<ActivitySession | undefined>;
  saveSession(session: ActivitySession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  summary(): Promise<ActivitySummary>;
}

export class InMemoryActivityRepository implements ActivityRepository {
  private readonly sessions = new Map<string, ActivitySession>();

  public listSessions(): Promise<readonly ActivitySession[]> {
    return Promise.resolve(this.sortedSessions());
  }

  public getSession(id: string): Promise<ActivitySession | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }

  public saveSession(session: ActivitySession): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }

  public deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }

  public summary(): Promise<ActivitySummary> {
    const sessions = this.sortedSessions();
    const movements = sessions.flatMap((session) => session.movements);

    return Promise.resolve({
      totalSessions: sessions.length,
      totalReps: movements.reduce((sum, movement) => sum + movement.reps, 0),
      validReps: movements.reduce((sum, movement) => sum + movement.validReps, 0),
      partialReps: movements.reduce((sum, movement) => sum + movement.partialReps, 0),
      lastActivityAt: sessions[0]?.startedAt,
    });
  }

  private sortedSessions(): readonly ActivitySession[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
