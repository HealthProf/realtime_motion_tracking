# Real-Time Motion Lab

A browser-based, real-time motion tracking and measurement tool for teaching biomechanics. It works like
Kinovea or Dartfish, but on the live camera feed instead of recorded playback. Everything runs on the
device: no video or data is uploaded.

## What it does

- Tracks a 33-point skeleton on the person in frame (MediaPipe Pose Landmarker; Lite, Full and Heavy models).
- Measures joint and segment angles, angular velocity and acceleration, and the position, velocity,
  acceleration and path length of any keypoint or the estimated centre of mass.
- Calibrates to metres from a reference object (or, less accurately, standing height).
- Records trials and re-filters them without lag (zero-phase Butterworth) before export.
- Exports a kinematics CSV with a methods header, a raw landmark CSV, a reloadable session file,
  PNG screenshots of key moments, and a local video with the overlays.
- Instant replay of the last 10 to 20 seconds with measurements intact.
- Activity presets (squat, sit-to-stand, vertical jump, gait, overhead reach), repetition detection,
  left/right symmetry (front views), and jump height from flight time.
- A setup coach that checks framing, distance, movement plane, tracking confidence, frame rate and camera level.
- Toggleable schematic anatomy layers: bones, muscles (with "muscles crossing this joint" highlighting),
  internal organs, arteries and veins with a direction-of-flow animation, nerves, joints and ligaments,
  lymphatics, and surface landmarks.
- Anatomy search: type a name and the structure is circled if it is in the picture, or an arrow shows
  which way to move the camera if it is not.
- Bike fit mode (indoor trainer) and running gait mode (treadmill): per-cycle measurements compared with
  sourced reference ranges, stated uncertainty, and options to try and re-measure.
- A "Why filtering matters" panel that shows how differentiation amplifies noise.
- Works offline after the first visit. A demo mode with synthetic data needs no camera.

Read `public/methods.html` (linked in the app as "Methods and limitations") before using the numbers.
The short version: this is a teaching tool, planar angles are only valid when the movement is perpendicular
to the camera, and acceleration is the least reliable output.

## Development

```bash
npm install
```

```bash
npm run assets
```

```bash
npm run dev
```

`npm run assets` downloads the three pose models (checksummed) and copies the MediaPipe WASM runtime into
`public/`. They are served from the site itself, so the app does not depend on a CDN at run time.

| Command | Purpose |
|---|---|
| `npm test` | Unit tests for the kinematics and analysis code (synthetic signals with known answers) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run e2e` | Browser smoke test against the build (needs Playwright with Chromium installed) |

Append `?demo=squat`, `?demo=jump`, `?demo=raise`, `?demo=cycle` or `?demo=run` to the URL to start the synthetic demo directly.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`.
One-time setup: in the repository settings, open Pages and set Source to "GitHub Actions".
Camera access requires HTTPS, which GitHub Pages provides.

## Layout

```
src/kinematics/   filters, resampling, derivatives, angles, calibration (pure functions)
src/analysis/     centre of mass, repetitions, symmetry, jump, residual analysis
src/capture/      trials, processing, CSV/session export, video, replay buffer
src/pose/         pose model wrapper, keypoint topology, synthetic demo poses
src/coach/        setup checks
src/anatomy/      schematic anatomy layers, structure catalog, search
src/modes/        bike fit and running gait analysis, reference ranges, reports
src/render/       canvas overlay and charts
src/presets/      activity presets (data only)
src/ui/, main.ts  interface wiring
tests/unit/       Vitest
tests/e2e/        Playwright smoke test
```

## License and credit

Free to use for educational purposes. Commercial use is not permitted, and any alteration needs the
author's written approval. Credit is required: "Real-Time Motion Lab by Timothy Curry", with a link to
this repository. See [LICENSE](LICENSE) for the full terms. To request permission, message Timothy Curry on LinkedIn.

This is a custom source-available license, not an open-source license.

Third-party components (Google's MediaPipe runtime and pose models, Apache 2.0) keep their own
licenses: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The anatomy layers are original
schematic drawings generated in code.
