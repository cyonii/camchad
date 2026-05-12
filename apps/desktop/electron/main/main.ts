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

app.setName('Home Workout Tracker');

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

interface ExerciseSet {
  readonly id: string;
  readonly exerciseType: string;
  readonly cameraAngle: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly reps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly formWarnings: readonly FormWarning[];
  readonly repEvents: readonly RepEvent[];
}

interface WorkoutSession {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly exercises: readonly ExerciseSet[];
  readonly notes?: string;
}

interface WorkoutSummary {
  readonly totalSessions: number;
  readonly totalReps: number;
  readonly validReps: number;
  readonly partialReps: number;
  readonly lastWorkoutAt?: string;
}

interface CameraPermissionResult {
  readonly granted: boolean;
  readonly reason?: string;
}

interface PersistedHistory {
  readonly sessions: readonly WorkoutSession[];
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
    title: 'Home Workout Tracker',
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
  return join(app.getPath('userData'), 'workout-history.json');
}

async function readHistory(): Promise<PersistedHistory> {
  try {
    const raw = await readFile(historyPath(), 'utf8');
    return JSON.parse(raw) as PersistedHistory;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { sessions: [] };
    }

    throw error;
  }
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
        'Camera permission is blocked for this app. Enable it in macOS System Settings, then restart the app.',
    };
  }

  const granted = await systemPreferences.askForMediaAccess('camera');
  return {
    granted,
    reason: granted
      ? undefined
      : 'Camera permission was not granted. Enable it in macOS System Settings, then restart the app.',
  };
}

ipcMain.handle('history:list', async (): Promise<readonly WorkoutSession[]> => {
  const history = await readHistory();
  return [...history.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
});

ipcMain.handle('history:save', async (_event, workoutSession: WorkoutSession): Promise<void> => {
  const history = await readHistory();
  const sessions = history.sessions.filter((existing) => existing.id !== workoutSession.id);
  await writeHistory({ sessions: [workoutSession, ...sessions] });
});

ipcMain.handle('history:summary', async (): Promise<WorkoutSummary> => {
  const history = await readHistory();
  const exercises = history.sessions.flatMap((workoutSession) => workoutSession.exercises);

  return {
    totalSessions: history.sessions.length,
    totalReps: exercises.reduce((sum, exercise) => sum + exercise.reps, 0),
    validReps: exercises.reduce((sum, exercise) => sum + exercise.validReps, 0),
    partialReps: exercises.reduce((sum, exercise) => sum + exercise.partialReps, 0),
    lastWorkoutAt: [...history.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
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

ipcMain.handle('notify:workout-reminder', (_event, body: string): void => {
  if (Notification.isSupported()) {
    new Notification({
      title: 'Workout reminder',
      body,
    }).show();
  }
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
