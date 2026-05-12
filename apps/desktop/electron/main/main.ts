import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

app.setName('Home Activity Tracker');

interface RepEvent {
  readonly repNumber: number;
  readonly timestampMs: number;
  readonly qualityScore: number;
  readonly depthScore: number;
  readonly alignmentScore: number;
  readonly warnings: readonly FormWarning[];
}

interface FormWarning {
  readonly code: string;
  readonly message: string;
}

interface MovementSegment {
  readonly id: string;
  readonly movementType: string;
  readonly cameraAngle: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly reps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly formWarnings: readonly FormWarning[];
  readonly repEvents: readonly RepEvent[];
}

interface ActivitySession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly movements: readonly MovementSegment[];
  readonly exercises?: readonly MovementSegment[];
  readonly notes?: string;
}

interface ActivitySummary {
  readonly totalSessions: number;
  readonly totalReps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly lastActivityAt?: string;
}

interface CameraPermissionResult {
  readonly granted: boolean;
  readonly reason?: string;
}

interface PersistedHistory {
  readonly sessions: readonly ActivitySession[];
}

let mainWindow: BrowserWindow | undefined;

function configureMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const origin = new URL(details.requestingUrl).origin;
      const isAppRenderer = app.isPackaged
        ? details.requestingUrl.startsWith('file://')
        : origin === 'http://127.0.0.1:5173';

      callback(isAppRenderer && permission === 'media');
    },
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'Home Activity Tracker',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    await mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  } else {
    await mainWindow.loadURL('http://127.0.0.1:5173');
  }
}

function historyPath(): string {
  return join(app.getPath('userData'), 'activity-history.json');
}

function legacyHistoryPath(): string {
  return join(app.getPath('userData'), 'workout-history.json');
}

async function readHistory(): Promise<PersistedHistory> {
  try {
    const raw = await readFile(historyPath(), 'utf8');
    return normalizeHistory(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return readLegacyHistory();
    }

    throw error;
  }
}

async function readLegacyHistory(): Promise<PersistedHistory> {
  try {
    const raw = await readFile(legacyHistoryPath(), 'utf8');
    return normalizeHistory(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { sessions: [] };
    }

    throw error;
  }
}

function normalizeHistory(value: unknown): PersistedHistory {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return { sessions: [] };
  }

  return {
    sessions: value.sessions.flatMap((session) => normalizeSession(session)),
  };
}

function normalizeSession(value: unknown): readonly ActivitySession[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.startedAt !== 'string') {
    return [];
  }

  const movements = Array.isArray(value.movements)
    ? value.movements
    : Array.isArray(value.exercises)
      ? value.exercises
      : [];

  return [
    {
      id: value.id,
      startedAt: value.startedAt,
      endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
      durationSeconds:
        typeof value.durationSeconds === 'number' ? value.durationSeconds : undefined,
      movements: movements.flatMap((movement) => normalizeMovementSegment(movement)),
      notes: typeof value.notes === 'string' ? value.notes : undefined,
    },
  ];
}

function normalizeMovementSegment(value: unknown): readonly MovementSegment[] {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.movementType !== 'string' ||
    typeof value.cameraAngle !== 'string' ||
    typeof value.startedAt !== 'string'
  ) {
    return [];
  }

  return [
    {
      id: value.id,
      movementType: value.movementType,
      cameraAngle: value.cameraAngle,
      startedAt: value.startedAt,
      endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
      reps: typeof value.reps === 'number' ? value.reps : 0,
      validReps: typeof value.validReps === 'number' ? value.validReps : 0,
      partialReps: typeof value.partialReps === 'number' ? value.partialReps : 0,
      formWarnings: Array.isArray(value.formWarnings)
        ? value.formWarnings.filter(isFormWarning)
        : [],
      repEvents: Array.isArray(value.repEvents) ? value.repEvents.filter(isRepEvent) : [],
    },
  ];
}

function isFormWarning(value: unknown): value is FormWarning {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function isRepEvent(value: unknown): value is RepEvent {
  return (
    isRecord(value) &&
    typeof value.repNumber === 'number' &&
    typeof value.timestampMs === 'number' &&
    typeof value.qualityScore === 'number' &&
    typeof value.depthScore === 'number' &&
    typeof value.alignmentScore === 'number' &&
    Array.isArray(value.warnings)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function writeHistory(history: PersistedHistory): Promise<void> {
  const target = historyPath();
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(history, null, 2), 'utf8');
  await rename(temp, target);
}

async function ensureCameraPermission(): Promise<CameraPermissionResult> {
  if (process.platform !== 'darwin') {
    return { granted: true };
  }

  const status = systemPreferences.getMediaAccessStatus('camera');

  if (status === 'granted') {
    return { granted: true };
  }

  if (status === 'denied' || status === 'restricted') {
    return {
      granted: false,
      reason:
        'Camera access is blocked for Home Activity Tracker. Enable it in macOS System Settings > Privacy & Security > Camera, then restart the app.',
    };
  }

  const granted = await systemPreferences.askForMediaAccess('camera');

  return {
    granted,
    reason: granted
      ? undefined
      : 'Camera access was not granted. Reopen Home Activity Tracker from /Applications and press Start to request access again.',
  };
}

ipcMain.handle('history:list', async (): Promise<readonly ActivitySession[]> => {
  const history = await readHistory();
  return [...history.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
});

ipcMain.handle('history:save', async (_event, activitySession: ActivitySession): Promise<void> => {
  const history = await readHistory();
  const sessions = history.sessions.filter((existing) => existing.id !== activitySession.id);
  await writeHistory({ sessions: [activitySession, ...sessions] });
});

ipcMain.handle('history:summary', async (): Promise<ActivitySummary> => {
  const history = await readHistory();
  const movements = history.sessions.flatMap((activitySession) => activitySession.movements);

  return {
    totalSessions: history.sessions.length,
    totalReps: movements.reduce((sum, movement) => sum + movement.reps, 0),
    validReps: movements.reduce((sum, movement) => sum + movement.validReps, 0),
    partialReps: movements.reduce((sum, movement) => sum + movement.partialReps, 0),
    lastActivityAt: [...history.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
      ?.startedAt,
  };
});

ipcMain.handle('camera:ensure-permission', ensureCameraPermission);

ipcMain.handle('settings:get-startup-enabled', (): boolean => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('settings:set-startup-enabled', (_event, enabled: boolean): void => {
  app.setLoginItemSettings({ openAtLogin: enabled });
});

ipcMain.handle('notify:activity-reminder', (_event, body: string): void => {
  if (Notification.isSupported()) {
    new Notification({
      title: 'Activity reminder',
      body,
    }).show();
  }
});

ipcMain.handle('app:exit', (): void => {
  app.quit();
});

void app.whenReady().then(() => {
  configureMediaPermissions();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
