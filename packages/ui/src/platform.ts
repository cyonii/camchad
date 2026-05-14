import {
  normalizeActivitySessions,
  type ActivitySession,
  type ActivitySummary,
} from '@camchad/activity-history';

export interface CameraPermissionResult {
  readonly granted: boolean;
  readonly reason?: string;
}

export interface HistoryStorageInfo {
  readonly bytes: number;
  readonly sessionCount: number;
  readonly locationLabel: string;
  readonly lastActivityAt?: string;
}

export interface HistoryClient {
  list(): Promise<readonly ActivitySession[]>;
  save(session: ActivitySession): Promise<void>;
  summary(): Promise<ActivitySummary>;
  clear(): Promise<void>;
  replace(sessions: readonly ActivitySession[]): Promise<void>;
  storageInfo(): Promise<HistoryStorageInfo>;
}

export interface SettingsClient {
  getStartupEnabled(): Promise<boolean>;
  setStartupEnabled(enabled: boolean): Promise<void>;
}

export interface NotificationClient {
  activityReminder(body: string): Promise<void>;
}

export interface CameraPermissionClient {
  ensureCameraPermission(): Promise<CameraPermissionResult>;
}

export interface AppLifecycleClient {
  exit(): Promise<void>;
}

export interface ActivityPlatform {
  readonly history: HistoryClient;
  readonly settings?: SettingsClient;
  readonly notifications?: NotificationClient;
  readonly cameraPermission?: CameraPermissionClient;
  readonly appLifecycle?: AppLifecycleClient;
}

export const localBrowserHistoryClient: HistoryClient = {
  async list(): Promise<readonly ActivitySession[]> {
    return readLocalSessions();
  },

  async save(session: ActivitySession): Promise<void> {
    const sessions = readLocalSessions();
    const nextSessions = [session, ...sessions.filter((existing) => existing.id !== session.id)];
    localStorage.setItem('camchad:sessions', JSON.stringify(nextSessions));
  },

  async summary(): Promise<ActivitySummary> {
    const sessions = readLocalSessions();
    const movements = sessions.flatMap((session) => session.movements);

    return {
      totalSessions: sessions.length,
      totalReps: movements.reduce((sum, movement) => sum + movement.reps, 0),
      validReps: movements.reduce((sum, movement) => sum + movement.validReps, 0),
      partialReps: movements.reduce((sum, movement) => sum + movement.partialReps, 0),
      lastActivityAt: sessions[0]?.startedAt,
    };
  },

  async clear(): Promise<void> {
    localStorage.removeItem('camchad:sessions');
    localStorage.removeItem('home-activity:sessions');
    localStorage.removeItem('home-workout:sessions');
  },

  async replace(sessions: readonly ActivitySession[]): Promise<void> {
    const normalizedSessions = normalizeActivitySessions(sessions);
    localStorage.setItem('camchad:sessions', JSON.stringify(normalizedSessions));
    localStorage.removeItem('home-activity:sessions');
    localStorage.removeItem('home-workout:sessions');
  },

  async storageInfo(): Promise<HistoryStorageInfo> {
    const sessions = readLocalSessions();
    const raw = localStorage.getItem('camchad:sessions') ?? '[]';

    return {
      bytes: new TextEncoder().encode(raw).byteLength,
      sessionCount: sessions.length,
      locationLabel: 'Browser local storage',
      lastActivityAt: sessions[0]?.startedAt,
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

function readLocalSessions(): readonly ActivitySession[] {
  const raw =
    localStorage.getItem('camchad:sessions') ??
    localStorage.getItem('home-activity:sessions') ??
    localStorage.getItem('home-workout:sessions') ??
    '[]';

  try {
    return normalizeActivitySessions(JSON.parse(raw));
  } catch {
    return [];
  }
}
