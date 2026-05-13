# CamChad

CamChad Workout is a local-first camera-based movement analysis app. CamChad is the short display name used for the installed app and app listings. The desktop app is the first-class target, with shared packages designed for web and future mobile reuse.

## Initial Scope

- Electron desktop app.
- React and TypeScript UI.
- Automatic exercise inference foundation with local movement validation.
- Local-only pose inference.
- Local activity history.
- Passive camera-angle guidance based on inferred exercise metadata.
- Repository hygiene from the start: formatting, linting, type checking, tests, pre-commit validation, and CI.

## Privacy

- No backend.
- No cloud upload.
- No telemetry.
- Camera frames stay local.
- Activity history is stored locally.

## Architecture Target

```text
apps/
  desktop/
  web/

packages/
  pose-core/
  movement-core/
  activity-history/
  ui/
```

## Movement Catalog

CamChad models exercises as catalog definitions. Each definition can describe body orientation, camera guidance, analysis signals, phase labels, telemetry fields, and support level. Push-ups and squats have validation-grade interpreters. Sit-ups, lunges, jumping jacks, planks, pull-ups, burpees, mountain climbers, high knees, lateral raises, and selected static holds have recognition interpreters that make them visible to the movement engine without claiming mature form validation yet. The broader catalog also includes planned exercises with no active interpreter so the product can show future coverage without pretending those movements are recognized.

## Development

```bash
npm install
npm run sync:mediapipe-assets
npm run validate
npm run build
```

The asset sync command copies MediaPipe WASM files from `@mediapipe/tasks-vision` and downloads local Pose Landmarker model variants into each app's `public/vendor/mediapipe` directory. Runtime inference should not fetch model assets from the network.

Run the desktop app:

```bash
npm run dev
```

This starts the Electron development flow. It also starts the desktop renderer dev server, but that renderer expects Electron's preload API and is not the browser web app.

Run the web app:

```bash
npm run dev:web
```

Use this command when you want to test the app directly in a browser. Do not use the Electron renderer URL from `npm run dev` as the web app.

## Desktop Packaging

Build and package the macOS desktop app:

```bash
npm install
npm run sync:mediapipe-assets
npm run package:desktop
```

The package command runs the full production build first, then creates an unpacked macOS app bundle under:

```text
release/desktop/mac-*/CamChad.app
```

Install it into the normal macOS Applications folder:

```bash
rm -rf "/Applications/CamChad.app"
ditto "release/desktop/mac-arm64/CamChad.app" "/Applications/CamChad.app"
```

If your output directory differs, replace `mac-arm64` with the directory that exists under `release/desktop`.

This local package is ad-hoc signed for development. For a distributable release outside your machine, add Developer ID signing and notarization before shipping.

After rebuilding, reinstall the app bundle if you want the copy in `/Applications` to reflect the latest local build:

```bash
rm -rf "/Applications/CamChad.app"
ditto "release/desktop/mac-arm64/CamChad.app" "/Applications/CamChad.app"
```

## Camera Notes

The web app is the simplest way to verify camera and pose behavior because browser camera permission handling is explicit and well surfaced.

The packaged Electron app must include both `NSCameraUsageDescription` and the `com.apple.security.device.camera` entitlement. The main process requests consent with Electron's `systemPreferences.askForMediaAccess('camera')` before the renderer calls `getUserMedia`; without the entitlement, macOS can open a dead capture stream without registering the app in Camera settings.

During local development, macOS can still attribute camera access to the launcher/Electron host. For example, launching from VS Code may use VS Code's camera permission, while launching from another terminal or automation app requires that launcher to have camera permission too.

If the packaged app still does not appear under System Settings > Privacy & Security > Camera after pressing Start, reset only this app's camera privacy entry and open it again from `/Applications`:

```bash
tccutil reset Camera app.homechad.workout
```

A distributable macOS build should add camera usage metadata, signing, and notarization before it is treated as production-ready.

## Commit History Standard

This repository should keep a human-readable commit history:

- repository standards and hygiene;
- core packages;
- app shells;
- integration and delivery wiring;
- bug fixes as focused follow-up commits.
