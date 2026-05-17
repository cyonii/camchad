import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeActivityHistory,
  normalizeActivitySessions,
  type ActivitySession,
  type ActivitySummary,
  type PersistedActivityHistory,
} from '@camchad/activity-history';

const __dirname = dirname(fileURLToPath(import.meta.url));

app.setName('CamChad');

interface CameraPermissionResult {
  readonly granted: boolean;
  readonly reason?: string;
}

interface HistoryStorageInfo {
  readonly bytes: number;
  readonly sessionCount: number;
  readonly locationLabel: string;
  readonly lastActivityAt?: string;
}

interface PoseTraceSaveResult {
  readonly filename: string;
  readonly path: string;
}

interface DeveloperReportSaveResult {
  readonly filename: string;
  readonly path: string;
}

let mainWindow: BrowserWindow | undefined;

function windowChromePlatform(): 'macos' | 'windows' | 'linux' {
  if (process.platform === 'darwin') {
    return 'macos';
  }

  if (process.platform === 'win32') {
    return 'windows';
  }

  return 'linux';
}

function readWindowChromeState(window: BrowserWindow): {
  readonly platform: 'macos' | 'windows' | 'linux';
  readonly isFocused: boolean;
  readonly isFullscreen: boolean;
  readonly isMaximized: boolean;
} {
  return {
    platform: windowChromePlatform(),
    isFocused: window.isFocused(),
    isFullscreen: window.isFullScreen(),
    isMaximized: window.isMaximized(),
  };
}

function emitWindowChromeState(window: BrowserWindow): void {
  if (!window.webContents.isDestroyed()) {
    window.webContents.send('window:state-changed', readWindowChromeState(window));
  }
}

function configureWindowChromeStateEvents(window: BrowserWindow): void {
  const emitState = (): void => emitWindowChromeState(window);

  window.on('focus', emitState);
  window.on('blur', emitState);
  window.on('maximize', emitState);
  window.on('unmaximize', emitState);
  window.on('enter-full-screen', emitState);
  window.on('leave-full-screen', emitState);
  window.on('restore', emitState);
}

function appIconPath(): string {
  return app.isPackaged
    ? join(__dirname, '../../dist/logo.png')
    : join(__dirname, '../../public/logo.png');
}

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
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'CamChad',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: '#050908',
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  configureWindowChromeStateEvents(mainWindow);

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

function developerTraceDirectory(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'pose-traces')
    : join(process.cwd(), '.dev', 'traces');
}

function developerReportDirectory(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), 'developer-reports')
    : join(process.cwd(), '.dev', 'reports');
}

async function readHistory(): Promise<PersistedActivityHistory> {
  try {
    const raw = await readFile(historyPath(), 'utf8');
    return normalizeActivityHistory(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { sessions: [] };
    }

    throw error;
  }
}

async function writeHistory(history: PersistedActivityHistory): Promise<void> {
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
        'Camera access is blocked for CamChad. Enable it in macOS System Settings > Privacy & Security > Camera, then restart the app.',
    };
  }

  const granted = await systemPreferences.askForMediaAccess('camera');

  return {
    granted,
    reason: granted
      ? undefined
      : 'Camera access was not granted. Reopen CamChad from /Applications and press Start to request access again.',
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

ipcMain.handle('history:clear', async (): Promise<void> => {
  await writeHistory({ sessions: [] });
});

ipcMain.handle(
  'history:replace',
  async (_event, sessions: readonly ActivitySession[]): Promise<void> => {
    await writeHistory({ sessions: normalizeActivitySessions(sessions) });
  },
);

ipcMain.handle('history:storage-info', async (): Promise<HistoryStorageInfo> => {
  const history = await readHistory();
  let bytes = 0;

  try {
    bytes = (await stat(historyPath())).size;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  return {
    bytes,
    sessionCount: history.sessions.length,
    locationLabel: app.getPath('userData'),
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

ipcMain.handle(
  'developer:save-pose-trace',
  async (_event, trace: unknown): Promise<PoseTraceSaveResult> => {
    if (!isPoseTraceRecord(trace)) {
      throw new Error('Cannot save malformed pose trace.');
    }

    const directory = developerTraceDirectory();
    await mkdir(directory, { recursive: true });
    const filename = poseTraceFilename(trace.createdAt);
    const target = join(directory, filename);
    await writeFile(target, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

    return {
      filename,
      path: target,
    };
  },
);

ipcMain.handle(
  'developer:save-runtime-benchmark',
  async (_event, report: unknown): Promise<DeveloperReportSaveResult> => {
    if (!isRuntimeBenchmarkReport(report)) {
      throw new Error('Cannot save malformed runtime benchmark report.');
    }

    const directory = developerReportDirectory();
    await mkdir(directory, { recursive: true });
    const filename = runtimeBenchmarkFilename(report.generatedAt);
    const target = join(directory, filename);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    return {
      filename,
      path: target,
    };
  },
);

ipcMain.handle('window:get-state', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    return {
      platform: windowChromePlatform(),
      isFocused: true,
      isFullscreen: false,
      isMaximized: false,
    };
  }

  return readWindowChromeState(window);
});

ipcMain.handle('window:minimize', (event): void => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event): void => {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    return;
  }

  if (process.platform === 'darwin') {
    window.setFullScreen(!window.isFullScreen());
    return;
  }

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.handle('window:close', (event): void => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

void app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconPath());
  }

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

function isPoseTraceRecord(value: unknown): value is {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly samples: readonly unknown[];
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'createdAt' in value &&
    typeof value.createdAt === 'string' &&
    'samples' in value &&
    Array.isArray(value.samples)
  );
}

function poseTraceFilename(createdAt: string): string {
  return `pose-trace-${createdAt.replaceAll(/[:.]/g, '-')}.json`;
}

function isRuntimeBenchmarkReport(value: unknown): value is {
  readonly generatedAt: string;
  readonly runtime: string;
  readonly result: unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'generatedAt' in value &&
    typeof value.generatedAt === 'string' &&
    'runtime' in value &&
    typeof value.runtime === 'string' &&
    'result' in value
  );
}

function runtimeBenchmarkFilename(generatedAt: string): string {
  return `perception-runtime-benchmark-${generatedAt.replaceAll(/[:.]/g, '-')}.json`;
}
