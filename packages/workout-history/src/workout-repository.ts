import type { WorkoutSession, WorkoutSummary } from './models.js';

export interface WorkoutRepository {
  listSessions(): Promise<readonly WorkoutSession[]>;
  getSession(id: string): Promise<WorkoutSession | undefined>;
  saveSession(session: WorkoutSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  summary(): Promise<WorkoutSummary>;
}

export class InMemoryWorkoutRepository implements WorkoutRepository {
  private readonly sessions = new Map<string, WorkoutSession>();

  public listSessions(): Promise<readonly WorkoutSession[]> {
    return Promise.resolve(this.sortedSessions());
  }

  public getSession(id: string): Promise<WorkoutSession | undefined> {
    return Promise.resolve(this.sessions.get(id));
  }

  public saveSession(session: WorkoutSession): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }

  public deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }

  public summary(): Promise<WorkoutSummary> {
    const sessions = this.sortedSessions();
    const exercises = sessions.flatMap((session) => session.exercises);

    return Promise.resolve({
      totalSessions: sessions.length,
      totalReps: exercises.reduce((sum, exercise) => sum + exercise.reps, 0),
      validReps: exercises.reduce((sum, exercise) => sum + exercise.validReps, 0),
      partialReps: exercises.reduce((sum, exercise) => sum + exercise.partialReps, 0),
      lastWorkoutAt: sessions[0]?.startedAt,
    });
  }

  private sortedSessions(): readonly WorkoutSession[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
