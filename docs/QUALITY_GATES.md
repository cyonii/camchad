# CamChad Quality Gates

CamChad is a local movement-analysis instrument. Capability language, movement promotion, privacy posture, and release readiness must be explicit. These gates are the minimum bar before we claim a feature is ready.

## Movement Promotion Gates

### Recognition-Ready

A movement is recognition-ready when the engine can identify the pattern without counting or validating quality.

- The movement has a structured `MovementDefinition`.
- Required body regions, primary joints, body orientation, camera sensitivity, and setup hints are declared.
- Recognition criteria are explicit and fail loudly if unsupported.
- Positive synthetic tests prove matching movement frames pass the criteria.
- Negative synthetic tests prove likely confusions do not pass as the movement.
- The Exercises page communicates that the movement is recognized, not validated.

### Count-Ready

A movement is count-ready when the engine can segment repetitions or hold events without claiming mature quality validation.

- Recognition-ready requirements are satisfied.
- The movement uses a shared primitive: cyclic joint flexion, alternating limb drive, span oscillation, asymmetrical stance, static hold, or compound transition.
- Repetition, hold, or cycle events are deterministic across replay fixtures.
- False-positive tests cover adjacent movement families.
- Activity history stores movement type, timing, count, confidence, and warning context.
- Log and telemetry surfaces label the movement as counted, not quality-validated.

### Validation-Ready

A movement is validation-ready when the engine can judge whether repetitions or holds satisfy quality thresholds.

- Count-ready requirements are satisfied.
- Validation criteria are declared separately from recognition criteria.
- The validator exposes phase, range, alignment/posture, rhythm, confidence, and tracking-quality metrics.
- Invalid, partial, and low-confidence cases emit explainable warnings.
- Deterministic tests cover shallow/incomplete reps, poor posture, camera-angle limitations, tracking loss, and likely confusion classes.
- Thresholds are documented in `docs/MOVEMENT_THRESHOLDS.md`.
- Local history stores enough quality detail for the Log page to explain what happened later.

### User-Ready

A movement is user-ready when it can be trusted in the shipped product experience.

- Validation-ready requirements are satisfied when the product claims validation.
- Live guidance gives useful setup, confidence, and camera-position advice.
- The Exercises page describes engine maturity honestly.
- Log views render the movement, sets, warnings, quality components, and telemetry without collapsing it into a generic rep count.
- Privacy handling is reviewed and no raw video is stored by default.
- The movement remains reliable in packaged Electron and browser runtimes.

## Confidence Language Rules

Use language that matches what the engine actually knows.

- `Candidate`: weak or early evidence. The UI may say the system is observing or evaluating a possible movement.
- `Recognized`: stable pattern confidence. The UI may say the movement is recognized, but not that quality is validated.
- `Counted`: repetition or hold events are being detected. The UI may show counts, cadence, and timing.
- `Validated`: quality thresholds are enforced. The UI may show valid reps, partial reps, and quality feedback.
- `Ambiguous`: two or more candidate profiles are close. The UI should show uncertainty and guidance, not a false winner.
- `Unknown`: tracking exists, but no movement profile has enough evidence. The UI should invite better framing or continued movement.
- `Tracking lost`: the pose signal is unavailable or too incomplete. The UI should prioritize camera/framing guidance.

Do not use “valid,” “quality,” “form,” or “validated” for a movement unless a validation profile is active and its criteria are passing.

## Privacy Review Checklist

Every new feature that touches camera, pose, history, files, or exports must answer these questions before it ships.

- Does it store raw video? If yes, is it explicit opt-in and locally managed?
- Does it store pose landmarks or derived biometric movement data?
- Does it expose local file paths in UI, logs, exports, or errors?
- Does it send any data off-device?
- Does it introduce a backend, cloud dependency, analytics SDK, telemetry SDK, or remote model call?
- Can the user export the data?
- Can the user delete the data?
- Is imported data normalized before use?
- Are destructive actions confirmed?
- Are generated benchmark reports, traces, and media kept out of git?

The default answer for networked inference, cloud sync, and remote telemetry is no.

## Release Readiness Checklist

Run this before any release candidate or packaged app handoff.

- `npm run clean`
- `npm install`
- `npm run sync:mediapipe-assets`
- `npm run validate`
- `npm run build`
- `npm run report:bundle:check`
- `npm run package:desktop`
- Verify web refresh routing for `/`, `/log`, `/exercises`, `/exercises/push-up`, and `/settings`.
- Verify packaged macOS camera permission from `/Applications/CamChad.app`.
- Verify camera start/stop keyboard behavior on the Activity view.
- Verify the Activity view, Log, Exercises, and Settings in dark and light themes.
- Verify no generic UI claims validation for count-ready or recognition-only movements.
- Verify local history export, import, clear sessions, and clear cache flows.
- Verify no stale push-up-specific language appears in generic engine UI.
- Verify bundle budget output and any perception benchmark reports are saved only under ignored local directories.
