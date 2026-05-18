import {
  mergeActivitySessions,
  normalizeActivityHistory,
  persistedActivityHistory,
  type ActivitySessionMergeSummary,
  type ActivitySession,
  type ActivitySummary,
} from '@camchad/activity-history';
import type { PoseRuntimeBenchmarkResult, PoseTrace } from '@camchad/pose-core';

export interface CameraPermissionResult {
  readonly granted: boolean;
  readonly reason?: string;
}

export interface HistoryStorageInfo {
  readonly bytes: number;
  readonly sessionCount: number;
  readonly locationLabel: string;
  readonly poseTraceLocationLabel?: string;
  readonly benchmarkReportLocationLabel?: string;
  readonly lastActivityAt?: string;
}

export interface HistoryClient {
  list(): Promise<readonly ActivitySession[]>;
  save(session: ActivitySession): Promise<void>;
  summary(): Promise<ActivitySummary>;
  clear(): Promise<void>;
  merge(sessions: readonly ActivitySession[]): Promise<ActivitySessionMergeSummary>;
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

export type WindowChromePlatform = 'macos' | 'windows' | 'linux' | 'browser';

export interface WindowChromeState {
  readonly platform: WindowChromePlatform;
  readonly isFocused: boolean;
  readonly isFullscreen: boolean;
  readonly isMaximized: boolean;
}

export interface WindowControlsClient {
  getState(): Promise<WindowChromeState>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  subscribe?(listener: (state: WindowChromeState) => void): () => void;
}

export interface PoseTraceSaveResult {
  readonly filename: string;
  readonly path?: string;
}

export interface RuntimeBenchmarkReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly runtime: 'web' | 'electron';
  readonly source: 'camera' | 'video_file';
  readonly sourceLabel?: string;
  readonly result: PoseRuntimeBenchmarkResult;
}

export interface DeveloperToolsClient {
  savePoseTrace(trace: PoseTrace): Promise<PoseTraceSaveResult>;
  saveRuntimeBenchmark?(report: RuntimeBenchmarkReport): Promise<PoseTraceSaveResult>;
}

export interface ActivityPlatform {
  readonly history: HistoryClient;
  readonly settings?: SettingsClient;
  readonly notifications?: NotificationClient;
  readonly cameraPermission?: CameraPermissionClient;
  readonly appLifecycle?: AppLifecycleClient;
  readonly windowControls?: WindowControlsClient;
  readonly developerTools?: DeveloperToolsClient;
}

export const localBrowserHistoryClient: HistoryClient = {
  async list(): Promise<readonly ActivitySession[]> {
    return readLocalSessions();
  },

  async save(session: ActivitySession): Promise<void> {
    const sessions = readLocalSessions();
    const nextSessions = [session, ...sessions.filter((existing) => existing.id !== session.id)];
    writeLocalSessions(nextSessions);
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
  },

  async merge(sessions: readonly ActivitySession[]): Promise<ActivitySessionMergeSummary> {
    const result = mergeActivitySessions(readLocalSessions(), sessions);
    writeLocalSessions(result.sessions);
    return result.summary;
  },

  async storageInfo(): Promise<HistoryStorageInfo> {
    const sessions = readLocalSessions();
    const raw =
      localStorage.getItem('camchad:sessions') ?? JSON.stringify(persistedActivityHistory([]));

    return {
      bytes: new TextEncoder().encode(raw).byteLength,
      sessionCount: sessions.length,
      locationLabel: 'Browser local storage',
      poseTraceLocationLabel: 'Downloaded manually from developer tools',
      benchmarkReportLocationLabel: 'Downloaded manually from developer tools',
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
  const raw = localStorage.getItem('camchad:sessions');

  if (!raw) {
    return [];
  }

  try {
    return normalizeActivityHistory(JSON.parse(raw)).sessions;
  } catch {
    return [];
  }
}

function writeLocalSessions(sessions: readonly ActivitySession[]): void {
  localStorage.setItem('camchad:sessions', JSON.stringify(persistedActivityHistory(sessions)));
}
