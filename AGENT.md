# Agent Operating Directives

Treat this repository as production-grade software. Optimise for correctness, reliability, security, maintainability, scalability, and long-term ownership.

## Engineering Discipline

- Build in small, reviewable commits with meaningful messages.
- Validate formatting, linting, type checking, and tests before every commit once tooling exists.
- Keep architecture explicit: desktop shell, web shell, pose estimation, exercise detection, session history, and storage must remain separately understandable.
- Do not couple exercise detectors to a specific pose model. Pose engines are adapters; detectors consume normalized pose frames.
- Treat camera access, local video, and workout history as private user data.
- Avoid telemetry, cloud upload, backend services, or external inference unless the product direction explicitly changes.
- Prefer deterministic state machines over threshold snippets hidden in UI code.
- When behavior depends on thresholds, name them, configure them, and test representative edge cases.

## Product Direction

- Start desktop-first with Electron, React, and TypeScript.
- Include a web renderer path because camera behavior is easier to test in browsers and the user wants eventual web/mobile reach.
- First exercise is push-ups only. Keep detector registration extensible for squats and other indoor exercises.
- Support side-view push-up tracking as the reliable default, with diagonal/front modes treated as less reliable until validated.
- Save a neat local exercise log with sessions, sets, rep events, and form warnings.
- Local video recording is a later opt-in feature, not a default.

## Lessons Already Learned

- In Electron on macOS, renderer `getUserMedia` is not enough. The main process should explicitly request/check camera permission through Electron APIs before the renderer opens a stream.
- In development, macOS may attribute camera access to the launcher or Electron host. Packaged builds need camera permission metadata and signing/notarization planning.
- macOS camera permission can differ by launcher. If the app works from VS Code but not from another terminal or automation environment, check the launcher's camera permission before rewriting capture code.
- Do not wait for video metadata before calling `video.play()` on a MediaStream in Electron. Attach stream, call play, then wait for usable video dimensions/current data.
- The UI must separate startup, preview active, and tracking states. Camera preview and pose tracking readiness are different milestones.
- Desktop packaging should be proven by running the actual package script. Commit build configuration, icons, and documentation; keep generated release artifacts ignored.
- The Electron development renderer is not the browser web app. `npm run dev` starts the native app; use `npm run dev:web` for browser testing.
- Packaged Electron renderer assets must use relative paths because `loadFile` runs from a `file://` URL inside the app bundle.
