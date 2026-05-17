# CamChad

CamChad is a local-first camera-based movement analysis app. It is being built as a private biomechanical activity system rather than a traditional workout tracker: the user opens the app, steps into frame, starts moving, and the engine interprets movement patterns locally.

The short product name is **CamChad**. The macOS app id is `app.homechad.workout`.

## Product Direction

CamChad should feel like a local movement-analysis instrument:

- no accounts, backend, cloud dependency, or remote telemetry;
- live camera-based pose inference on-device;
- automatic movement recognition instead of manual exercise selection;
- validation-ready movement profiles where the engine can judge rep quality;
- recognition-only profiles where the engine can identify movement patterns without claiming mature validation;
- local session history with movement segments, rep events, guidance, and telemetry;
- tactical, readable instrumentation UI for live analysis, logs, exercises, and settings.

Push-ups and squats are currently the strongest validation targets. They are not the product boundary; they are the first movement problems used to harden the architecture.

## Privacy Model

CamChad is local by design.

- Camera frames stay on the device.
- Pose inference runs locally through bundled MediaPipe assets.
- Session history is stored locally.
- Developer pose traces record landmark data, not raw video.
- There is no backend and no cloud upload path.

Treat raw video as sensitive. Do not add video upload, cloud sync, or remote analysis without making it an explicit product decision.

## Monorepo Layout

```text
apps/
  desktop/          Electron desktop app
  web/              Browser web app

packages/
  pose-core/        Pose estimator contracts, MediaPipe adapter, model metadata, trace tools
  movement-core/    Body state, temporal windows, recognition, validation, telemetry
  activity-history/ Local session models, normalization, summaries, persistence contracts
  ui/               Shared React app shell, activity view, logs, exercises, settings

docs/
  ENGINE_PIPELINE.md
  MOVEMENT_THRESHOLDS.md
```

The app shells should stay thin. Product behavior belongs in shared packages unless it is truly platform-specific.

## Engine Pipeline

```text
camera frame
-> pose estimator
-> BodyState extraction
-> temporal movement window
-> movement profile inference
-> movement validators
-> telemetry extraction
-> session history
-> UI guidance
```

Important engine concepts:

- `PoseFrame`: raw timestamped landmark output from the active pose model.
- `BodyState`: normalized body-relative representation with coverage, orientation, joint angles, and geometry signals.
- `MovementWindow`: rolling temporal buffer for velocity, signal range, rhythm, confidence, and missing-frame accounting.
- `MovementDefinition`: profile metadata for recognition maturity, body orientation, required regions, camera guidance, telemetry, and validation status.
- `MovementInterpreterState`: current recognition, phase, rep counts, warnings, and metrics for one movement profile.

See [docs/ENGINE_PIPELINE.md](docs/ENGINE_PIPELINE.md) for the full architecture notes.

## Movement Coverage

Validation-ready:

- push-ups
- squats

Recognition-only:

- sit-ups
- lunges
- jumping jacks
- planks
- pull-ups
- burpees
- mountain climbers
- high knees
- lateral raises
- yoga/static holds

Planned profiles are also listed in the Exercises page as dormant engine capabilities. They should not pretend to be recognized until they have structured definitions and tests.

## Prerequisites

- Node.js compatible with the workspace toolchain.
- npm.
- macOS for the current desktop packaging workflow.
- Camera access for live tracking.

Install dependencies:

```bash
npm install
```

Sync local MediaPipe assets:

```bash
npm run sync:mediapipe-assets
```

This copies MediaPipe WASM files and downloads Pose Landmarker Lite, Full, and Heavy model assets into each app's `public/vendor/mediapipe` directory. Runtime inference should not fetch model assets from the network.

## Development Commands

Run the Electron desktop app:

```bash
npm run dev
```

Run the browser web app:

```bash
npm run dev:web
```

Build everything:

```bash
npm run build
```

Validate before committing:

```bash
npm run validate
```

Useful maintenance commands:

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run clean
```

## Web Routes

The web app supports browser paths:

- `/` for Activity
- `/log`
- `/exercises`
- `/exercises/push-up`
- `/settings`

The Electron renderer uses memory routing because packaged desktop apps are loaded from local files.

## Desktop Packaging

Build and package the macOS desktop app:

```bash
npm install
npm run sync:mediapipe-assets
npm run package:desktop
```

The package command runs the production build first, then creates an unpacked macOS app bundle under:

```text
release/desktop/mac-*/CamChad.app
```

Install it into `/Applications`:

```bash
rm -rf "/Applications/CamChad.app"
ditto "release/desktop/mac-arm64/CamChad.app" "/Applications/CamChad.app"
```

If your output directory differs, replace `mac-arm64` with the directory that exists under `release/desktop`.

This local package is ad-hoc signed for development. A distributable release needs Developer ID signing and notarization.

## Camera Notes

The web app is usually the fastest way to verify camera and pose behavior because browser camera prompts are explicit.

The packaged Electron app must include:

- `NSCameraUsageDescription`
- `com.apple.security.device.camera`
- a main-process camera permission request through `systemPreferences.askForMediaAccess('camera')`

During local development, macOS may attribute camera access to the launching app. Launching from VS Code may use VS Code's camera permission; launching from another terminal or automation app may require that launcher to have camera permission.

If the packaged app does not appear in System Settings > Privacy & Security > Camera after pressing Start, reset only CamChad's camera privacy entry and open it again from `/Applications`:

```bash
tccutil reset Camera app.homechad.workout
```

## Developer Pose Traces

CamChad has a developer-only pose trace workflow for building deterministic replay fixtures without storing raw video.

Enable it in the app with either:

```text
?dev-trace=1
?trace=pose
```

Disable it with:

```text
?dev-trace=0
```

When enabled:

- Electron saves pose traces to `.dev/traces` in development.
- Packaged Electron saves traces under the app user-data directory.
- Web downloads the trace JSON because browsers cannot silently write to repo paths.
- Traces include pose landmarks, missing-frame samples, session id, movement labels, camera angle, and capture notes.
- Traces do not include raw camera frames.

The `.dev` directory is intentionally local and ignored by git.

## Perception Reports

Generate the current local perception asset and capability report:

```bash
npm run report:perception
```

The report is written under `.dev/reports`. It confirms dependency and model asset status, but it does not claim CPU/FPS/latency measurements. Runtime performance must be measured inside a real browser or Electron video pipeline.

## Testing Standards

The repository uses:

- Prettier for formatting;
- ESLint for linting;
- TypeScript for static checks;
- Vitest for deterministic unit and engine tests;
- Husky/lint-staged for pre-commit hygiene;
- GitHub Actions CI.

Before committing, run:

```bash
npm run validate
npm run build
```

For movement-engine changes, add or update deterministic tests around sequence replay, recognition confidence, phase transitions, rep counting, and telemetry.

## Git Discipline

Use Conventional Commit style and keep commits atomic:

```text
feat(movement): add high-knees recognition criteria
refactor(history): remove obsolete session fallback
test(pose): add trace replay coverage
docs(readme): document developer trace workflow
```

Do not use git as backup storage. The history should read like the system was built intentionally.

## Current Engineering Priorities

Near-term priorities are tracked locally under `.dev/plans` and `.dev/core-movement-analysis-engine-plan.md`.

Current themes:

- improve movement-profile specificity for recognition-only profiles;
- build real browser/Electron runtime perception benchmarking;
- compare Pose Lite, Full, and Heavy with measured latency, FPS, detection ratio, jitter, and downstream recognition stability;
- grow a local pose-trace corpus for replay tests;
- keep removing prototype-era assumptions when product direction changes.
