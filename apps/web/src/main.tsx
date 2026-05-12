import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  browserCameraPermissionClient,
  localBrowserHistoryClient,
  WorkoutApp,
} from '@home-workout/ui';
import '@home-workout/ui/styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WorkoutApp
      assets={{
        modelAssetPath: '/vendor/mediapipe/models/pose_landmarker_lite.task',
        wasmAssetPath: '/vendor/mediapipe/wasm',
      }}
      platform={{
        history: localBrowserHistoryClient,
        cameraPermission: browserCameraPermissionClient,
      }}
    />
  </React.StrictMode>,
);
