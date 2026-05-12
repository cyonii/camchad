import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  browserAppLifecycleClient,
  browserCameraPermissionClient,
  localBrowserHistoryClient,
  ActivityApp,
} from '@home-activity/ui';
import '@home-activity/ui/styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ActivityApp
      assets={{
        logoAssetPath: '/logo.png',
        modelAssetPath: '/vendor/mediapipe/models/pose_landmarker_lite.task',
        wasmAssetPath: '/vendor/mediapipe/wasm',
      }}
      platform={{
        history: localBrowserHistoryClient,
        cameraPermission: browserCameraPermissionClient,
        appLifecycle: browserAppLifecycleClient,
      }}
    />
  </React.StrictMode>,
);
