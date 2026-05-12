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
```

The asset sync command copies MediaPipe WASM files from `@mediapipe/tasks-vision` and downloads the Pose Landmarker Lite model into each app's local `public/vendor/mediapipe` directory. Runtime inference should not fetch model assets from the network.
