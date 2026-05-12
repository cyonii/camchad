import React from 'react';
import { createRoot } from 'react-dom/client';

import type { CameraPermissionResult, WorkoutPlatform } from '@home-workout/ui';
import { WorkoutApp } from '@home-workout/ui';
import '@home-workout/ui/styles.css';
import type { WorkoutSession, WorkoutSummary } from '@home-workout/workout-history';

const desktopApi = window.homeWorkout;

const platform: WorkoutPlatform = {
  history: {
    async list(): Promise<readonly WorkoutSession[]> {
      return (await desktopApi.history.list()) as readonly WorkoutSession[];
    },
    async save(session: WorkoutSession): Promise<void> {
      await desktopApi.history.save(session);
    },
    async summary(): Promise<WorkoutSummary> {
      return (await desktopApi.history.summary()) as WorkoutSummary;
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
    workoutReminder: (body) => desktopApi.notifications.workoutReminder(body),
  },
  appLifecycle: {
    exit: () => desktopApi.app.exit(),
  },
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WorkoutApp
      assets={{
        logoAssetPath: './logo.png',
        modelAssetPath: './vendor/mediapipe/models/pose_landmarker_lite.task',
        wasmAssetPath: './vendor/mediapipe/wasm',
      }}
      platform={platform}
    />
  </React.StrictMode>,
);
