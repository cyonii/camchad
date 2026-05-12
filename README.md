# Home Workout Tracker

Local-first camera-based home workout tracker. The desktop app is the first-class target, with shared packages designed for web and future mobile reuse.

## Initial Scope

- Electron desktop app.
- React and TypeScript UI.
- Push-up tracking first.
- Local-only pose inference.
- Local workout history.
- Camera-angle options with side view as the recommended default.
- Repository hygiene from the start: formatting, linting, type checking, tests, pre-commit validation, and CI.

## Privacy

- No backend.
- No cloud upload.
- No telemetry.
- Camera frames stay local.
- Workout history is stored locally.

## Architecture Target

```text
apps/
  desktop/
  web/

packages/
  pose-core/
  exercise-core/
  workout-history/
  ui/
```

## Development

```bash
npm install
npm run sync:mediapipe-assets
npm run validate
npm run build
```

The asset sync command copies MediaPipe WASM files from `@mediapipe/tasks-vision` and downloads the Pose Landmarker Lite model into each app's local `public/vendor/mediapipe` directory. Runtime inference should not fetch model assets from the network.

Run the desktop app:

```bash
npm run dev
```

Run the web app:

```bash
npm run dev:web
```

## Camera Notes

The web app is the simplest way to verify camera and pose behavior because browser camera permission handling is explicit and well surfaced.

The Electron app asks macOS for camera access from the main process before the renderer calls `getUserMedia`. During local development, macOS can still attribute camera access to the launcher/Electron host. A distributable macOS build should add camera usage metadata, signing, and notarization before it is treated as production-ready.

## Commit History Standard

This repository should keep a human-readable commit history:

- repository standards and hygiene;
- core packages;
- app shells;
- integration and delivery wiring;
- bug fixes as focused follow-up commits.
