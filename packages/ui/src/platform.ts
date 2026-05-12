import type { WorkoutSession, WorkoutSummary } from '@home-workout/workout-history';

export interface CameraPermissionResult {
  readonly granted: boolean;
  readonly reason?: string;
}

export interface HistoryClient {
  list(): Promise<readonly WorkoutSession[]>;
  save(session: WorkoutSession): Promise<void>;
  summary(): Promise<WorkoutSummary>;
}

export interface SettingsClient {
  getStartupEnabled(): Promise<boolean>;
  setStartupEnabled(enabled: boolean): Promise<void>;
}

export interface NotificationClient {
  workoutReminder(body: string): Promise<void>;
}

export interface CameraPermissionClient {
  ensureCameraPermission(): Promise<CameraPermissionResult>;
}

export interface AppLifecycleClient {
  exit(): Promise<void>;
}

export interface WorkoutPlatform {
  readonly history: HistoryClient;
  readonly settings?: SettingsClient;
  readonly notifications?: NotificationClient;
  readonly cameraPermission?: CameraPermissionClient;
  readonly appLifecycle?: AppLifecycleClient;
}

export const localBrowserHistoryClient: HistoryClient = {
  async list(): Promise<readonly WorkoutSession[]> {
    return readLocalSessions();
  },

  async save(session: WorkoutSession): Promise<void> {
    const sessions = readLocalSessions();
    const nextSessions = [session, ...sessions.filter((existing) => existing.id !== session.id)];
    localStorage.setItem('home-workout:sessions', JSON.stringify(nextSessions));
  },

  async summary(): Promise<WorkoutSummary> {
    const sessions = readLocalSessions();
    const exercises = sessions.flatMap((session) => session.exercises);

    return {
      totalSessions: sessions.length,
      totalReps: exercises.reduce((sum, exercise) => sum + exercise.reps, 0),
      validReps: exercises.reduce((sum, exercise) => sum + exercise.validReps, 0),
      partialReps: exercises.reduce((sum, exercise) => sum + exercise.partialReps, 0),
      lastWorkoutAt: sessions[0]?.startedAt,
    };
  },
};

export const browserCameraPermissionClient: CameraPermissionClient = {
  async ensureCameraPermission(): Promise<CameraPermissionResult> {
    return { granted: true };
  },
};

export const browserAppLifecycleClient: AppLifecycleClient = {
  async exit(): Promise<void> {
    window.close();

    if (!window.closed) {
      document.documentElement.dataset.appExitRequested = 'true';
    }
  },
};

function readLocalSessions(): readonly WorkoutSession[] {
  return JSON.parse(localStorage.getItem('home-workout:sessions') ?? '[]') as WorkoutSession[];
}
