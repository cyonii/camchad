import React from 'react';
import { createRoot } from 'react-dom/client';

import type {
  CameraPermissionResult,
  ActivityPlatform,
  HistoryStorageInfo,
  WindowChromeState,
} from '@camchad/ui';
import { ActivityApp } from '@camchad/ui';
import '@camchad/ui/styles.css';
import type { ActivitySession, ActivitySummary } from '@camchad/activity-history';

const desktopApi = window.camChad;

const platform: ActivityPlatform = {
  history: {
    async list(): Promise<readonly ActivitySession[]> {
      return (await desktopApi.history.list()) as readonly ActivitySession[];
    },
    async save(session: ActivitySession): Promise<void> {
      await desktopApi.history.save(session);
    },
    async summary(): Promise<ActivitySummary> {
      return (await desktopApi.history.summary()) as ActivitySummary;
    },
    async clear(): Promise<void> {
      await desktopApi.history.clear();
    },
    async replace(sessions: readonly ActivitySession[]): Promise<void> {
      await desktopApi.history.replace(sessions);
    },
    async storageInfo(): Promise<HistoryStorageInfo> {
      return (await desktopApi.history.storageInfo()) as HistoryStorageInfo;
    },
  },
  cameraPermission: {
    async ensureCameraPermission(): Promise<CameraPermissionResult> {
      return (await desktopApi.camera.ensurePermission()) as CameraPermissionResult;
    },
  },
  settings: {
    getStartupEnabled: () => desktopApi.settings.getStartupEnabled(),
    setStartupEnabled: (enabled) => desktopApi.settings.setStartupEnabled(enabled),
  },
  notifications: {
    activityReminder: (body) => desktopApi.notifications.activityReminder(body),
  },
  appLifecycle: {
    exit: () => desktopApi.app.exit(),
  },
  windowControls: {
    getState: async () => (await desktopApi.windowControls.getState()) as WindowChromeState,
    minimize: () => desktopApi.windowControls.minimize(),
    toggleMaximize: () => desktopApi.windowControls.toggleMaximize(),
    close: () => desktopApi.windowControls.close(),
    subscribe: (listener) =>
      desktopApi.windowControls.subscribe((state) => {
        listener(state as WindowChromeState);
      }),
  },
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ActivityApp
      assets={{
        exerciseGuideAssetBasePath: './exercise-guides',
        logoAssetPath: './logo.png',
        modelAssetPath: './vendor/mediapipe/models/pose_landmarker_full.task',
        wasmAssetPath: './vendor/mediapipe/wasm',
      }}
      platform={platform}
      routingMode="memory"
    />
  </React.StrictMode>,
);
