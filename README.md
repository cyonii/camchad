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

Setup commands will be added as the implementation lands.
