# Agent Operating Directives

Treat this repository like software you will still own after it ships. Optimize for correctness, reliability, privacy, maintainability, and a clean path for the next engineer. Move quickly when the change is simple, but do not trade away clarity or future extension for speed.

## How We Work

- Work in small, reviewable commits with Conventional Commit messages. Keep related changes together and keep unrelated changes apart.
- Before committing follow-up work, decide whether it corrects or completes a recent commit. If it does, amend or autosquash instead of adding noisy history.
- Always inspect the actual working tree with `git status` and `git diff` before summarizing, staging, or writing a commit message. Memory is not the source of truth; the current diff is.
- If hooks or formatters rewrite files, re-check the diff and re-add the rewritten files before committing.
- Treat human edits as authoritative. If the working tree changes under you, assume the user made those edits and build from them unless they explicitly ask for a revert.
- Validate formatting, linting, type checking, and tests before every commit once the relevant tooling exists.
- Keep documentation current when commands, setup, architecture, product behavior, or packaging steps change.

## Architecture Principles

- Keep the major boundaries easy to explain: desktop shell, web shell, pose estimation, movement interpretation, session orchestration, activity history, storage, and UI should remain separately understandable.
- Separate the kind of decision a module is making. Domain rules answer what is true; orchestration answers when things happen; adapters and services answer how side effects happen.
- Keep side effects at explicit boundaries: Electron main/preload APIs, browser APIs, storage clients, React effects, and package scripts. Do not hide I/O, time, camera access, or persistence inside formatters, mappers, or pure movement logic.
- Prefer pure helpers for geometry, recognition rules, thresholds, scoring, and history modeling. They should be testable with plain input/output assertions.
- If testing a unit requires mocking time, media devices, storage, React lifecycle, and package internals at once, the design is too tangled. Split it before adding more behavior.
- Do not expand already-complex functions just to finish a feature. Extract a small module, name the boundary, and leave the system easier to change than you found it.
- Avoid compatibility shims unless they protect real local user data. Migration paths are valuable; alias-only modules and duplicated entry points are usually debt.

## Movement Product Direction

- CamChad is a local-first biomechanical movement system, not a traditional exercise picker. The user should be able to open the app, step into frame, move, and let the system infer what is happening.
- Supported exercises are entries in a movement catalog, not separate product modes. Push-ups are one catalog entry and should not define the architecture, naming, UI language, or persistence model.
- Build movement support as definitions, recognizers, validators, session events, and UI metadata. Avoid one-off UI branches or persistence shortcuts that only make sense for one exercise.
- Treat movement recognition and repetition validation as separate concerns. The system can infer that movement resembles an exercise before any repetition is valid, and it should say so explicitly in state.
- Sessions are generic activity periods. Movement segments emerge from interpreter and orchestrator state; do not rebuild the product around manual exercise modes or session-wide exercise labels.
- Do not couple movement interpreters to a specific pose model. Pose engines are adapters; interpreters consume normalized pose frames.
- Prefer deterministic state machines, geometric relationships, and temporal confidence windows over threshold snippets hidden in UI code. When behavior depends on thresholds, name them, configure them, and test representative edge cases.
- Surface camera-angle guidance passively from movement metadata. Do not make calibration advice feel like a required exercise-selection flow.
- Logs and charts must preserve movement-level detail. A session can contain multiple movements, sets, rests, camera contexts, warnings, and quality signals; do not flatten that into a single undifferentiated rep count.

## Privacy And Platform

- Camera frames, local video, activity history, settings, and model outputs are private user data.
- Avoid telemetry, cloud upload, backend services, or external inference unless the product direction explicitly changes.
- Local video recording is a later opt-in feature, not a default.
- Desktop packaging must be proven by running the actual package script. Keep generated release artifacts ignored.
- In packaged Electron on macOS, camera support requires both `NSCameraUsageDescription` and `com.apple.security.device.camera` in the signed app entitlements. Verify with `codesign -d --entitlements :-` when camera behavior is suspicious.
- Use Electron's main-process `systemPreferences.askForMediaAccess('camera')` before renderer `getUserMedia` in packaged builds. Without camera entitlements, macOS may open a dead stream and never list the app in Camera settings.
- In development, macOS may attribute camera access to the launcher or Electron host. If the app works from VS Code but not from another terminal or automation environment, check the launcher's camera permission before rewriting capture code.
- Do not wait for video metadata before calling `video.play()` on a MediaStream in Electron. Attach the stream, call play, then wait for usable video dimensions/current data.
- Packaged Electron renderer assets must use relative paths because `loadFile` runs from a `file://` URL inside the app bundle.
- The Electron development renderer is not the browser web app. `npm run dev` starts the native app; use `npm run dev:web` for browser testing.

## UI And Experience

- The interface should feel like a precise local movement instrument: tactical, restrained, readable, and purposeful. Avoid visual noise that competes with the live camera feed.
- The live preview is the center of the product. Telemetry should support the movement analysis without making the user feel like they are filling out a workout form.
- Keep dark and light themes polished. Check contrast, body copy, focus states, and important controls in both schemes.
- Keep interactions accessible: semantic buttons and inputs, keyboard-reachable controls, visible focus states, and clear labels for icon-only actions.
- Design responsive surfaces with stable dimensions. Text must not overlap, controls must not resize unpredictably, and scroll should be owned by the column or content region that needs it.
- Styling should reflect state already computed elsewhere. Do not make CSS or JSX styling branches re-infer movement, permission, or session rules.

## Testing And Quality Gates

- For new behavior, add focused deterministic tests where the risk lives: movement logic in `movement-core`, history modeling in `activity-history` or chart helpers, UI behavior in UI tests when available.
- For bugs, reproduce the bug with a failing test first whenever the behavior can be tested deterministically. Then make the smallest fix that turns that test green without weakening existing behavior.
- Keep tests fast and honest. Prefer lightweight fixtures and explicit inputs over broad global mocks.
- Test names should describe the scenario and expected outcome clearly enough that a failure reads like a bug report.
- When touching code, ask whether nearby critical paths lack coverage. Add or update tests if the change increases risk or documents a meaningful contract.

## Comments And Documentation

- Write code that mostly explains itself through names, types, and structure.
- Add comments when they capture intent, constraints, trade-offs, platform quirks, or edge cases a future engineer could reasonably miss.
- Do not use comments to narrate control flow. If a comment is needed to explain how ordinary code works, refactor the code.
- For non-obvious movement thresholds, pose-model assumptions, macOS camera behavior, migration paths, and privacy decisions, leave a short note near the decision.
- Keep `README.md`, packaging instructions, and this file aligned with durable changes. Add guidance here only when it should survive beyond the current task.

## Dependencies And Tools

- Prefer the repo's existing stack and package patterns unless there is a clear reason to change them.
- Well-tested packages are welcome when they replace real complexity, improve correctness, or reduce maintenance risk. Do not add a dependency just because it is convenient.
- Keep package adoption local to the problem it solves, document why it earns its place, and verify the build output after adding it.
