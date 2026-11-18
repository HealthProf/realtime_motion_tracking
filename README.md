# Real-Time Motion Lab

A browser-based, markerless video analysis tool for teaching biomechanics. It measures movement on the
live camera feed as well as in recorded clips. Everything runs on the device: no video or data is uploaded.

## What it does

- Tracks a 33-point skeleton on the person in frame (MediaPipe Pose Landmarker; Lite, Full and Heavy models).
- Measures joint and segment angles, angular velocity and acceleration, and the position, velocity,
  acceleration and path length of any keypoint or the estimated centre of mass.
- Calibrates to metres from a reference object, a weight plate, or (less accurately) standing height.
- Records trials and re-filters them without lag (zero-phase Butterworth) before export.
- Exports a kinematics CSV with a methods header, a raw landmark CSV, a reloadable session file,
  PNG screenshots of key moments, and a local video with the overlays.
- Instant replay of the last 10 to 20 seconds with measurements intact.
- Delayed view: the picture and measurements from 5 to 60 seconds ago (adjustable), so a person can
  perform a movement and then turn to the screen and watch it. A small live picture stays in the corner.
- Full screen view for watching from a distance, with large measurement tiles and the live plot along the
  bottom. Buttons choose what is shown (each panel and each measurement) and hide themselves when idle.
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
- Video files: load a recorded clip instead of the camera, play it with live measurements, or step
  through every frame for a trial with no skipped frames. Slow-motion factor for high-speed footage.
- Planes of motion and axes of rotation drawn on the person, each with its own toggle, plus a fixed
  three-plane guide figure that marks which plane the camera is looking at.
- Teaching overlays: line of gravity and base of support, velocity vectors (including v = ωr),
  the static moment of gravity about a joint with its moment arm, and live angle-angle plots.
- Weight lifting mode: follows the barbell plate, calibrates from the plate diameter, and reports
  per-lift range, mean, propulsive and peak velocity, force, work and power for a typed-in load.
- Rough calibration from your own height with a countdown, so one person can set it up alone.
- A "Why filtering matters" panel that shows how differentiation amplifies noise.
- Works offline after the first visit. A demo mode with synthetic data needs no camera.

Read `public/methods.html` (linked in the app as "Methods and limitations") before using the numbers.
Weight lifting mode has been checked against synthetic lifts with known answers, not yet against
real lifts measured with a position transducer or force plate.
The short version: this is a teaching tool, planar angles are only valid when the movement is perpendicular
to the camera, and acceleration is the least reliable output.

## Course projects

The start page offers two choices: the **Motion Lab** (`lab.html`, everything described above) and
**Course projects** (`course.html`), a focused page for a course's video analysis assignments. Students
enter a code from the instructor; the page then loads the course videos and offers only what the project needs:

- Scrub and step a clip frame by frame, then capture a **snapshot** of the moment.
- Draw and write on each snapshot: text, arrows, lines, labelled force arrows, freehand, circles, a
  three-point angle, plane panels and axes of rotation. Undo and redo, select and move, mouse or touch.
- Name each snapshot and pick the prompt it answers. A checklist shows only structure (is there a snapshot,
  text and a drawing for each prompt); nothing in the page suggests answers.
- Compare two clips side by side: line them up at the same moment, lock them together, and they play and
  step in sync. Text and drawings placed over the video show for a set stretch of time.
- Export a PDF of an analysis (cover page plus one page per snapshot) or a video of the comparison, named
  like `Rivera-P1-A1.pdf`, to upload to the course site.
- Work saves on the device as it goes (IndexedDB). A backup file moves it to another device.

There is no pose tracking on this page, by design: students mark everything themselves.

### Making a course pack

The course settings and videos are encrypted with a key derived from the course code (PBKDF2-SHA256,
600 000 iterations, then AES-GCM-256). Each video has its own random key, stored inside the encrypted
settings. Only the encrypted files are committed; the plain settings and videos stay on your computer.

1. Copy `course-src.example` to `course-src` (git ignores `course-src/`) and edit `course.json`:
   projects, analyses, prompts, points and the clips. Put the video files beside it. MP4 (H.264) plays in
   every browser; ffprobe, if installed, measures each clip's frame rate (or give `"fps"`).
2. Build the pack with a code of at least 12 characters, ideally three or four random words:

```bash
COURSE_CODE="your code words here" npm run pack
```

3. Commit `public/course/` (the encrypted `pack.json` and `v/*.bin`) and push. Give the code to students.

To change the code each semester, run the pack command again with the new code; to start students' saved
work afresh, also change `"id"` in `course.json`. Without any videos in the settings, students are asked to
choose the video files from their own device instead.

What the code does and does not do: without it, nothing course-specific can be read from the site, not
even from the page source. Anyone who has the code can open the course, so it keeps out the public but is
not account security. A short code could be guessed offline, which is why the script refuses codes under
12 characters. Large videos make a large repository (GitHub warns at 50 MB per file and refuses 100 MB),
so compress clips before packing.

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
| `npm run e2e` | Browser smoke test of the Motion Lab against the build (needs Playwright with Chromium installed) |
| `npm run e2e:course` | Browser test of the course page against the build, with a test pack (also needs ffmpeg) |
| `npm run pack` | Encrypts `course-src/` into `public/course/` (see above) |

The smoke test can also check frame-by-frame video analysis: set `TEST_VIDEO` to a clip and
`TEST_VIDEO_FRAMES` to its frame count (needs `npm run assets`).

Append `?demo=squat`, `?demo=jump`, `?demo=raise`, `?demo=cycle`, `?demo=run` or `?demo=lift` to the URL (the lab page, or the start page, which forwards it) to start the synthetic demo directly.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`.
One-time setup: in the repository settings, open Pages and set Source to "GitHub Actions".
Camera access requires HTTPS, which GitHub Pages provides.

## Layout

```
src/kinematics/   filters, resampling, derivatives, angles, calibration (pure functions)
src/analysis/     centre of mass, repetitions, symmetry, jump, residual analysis, body planes,
                  static joint moments, standing-height calibration
src/lift/         plate detection and tracking, barbell mechanics
src/capture/      trials, processing, CSV/session export, video, replay buffer, delayed view
src/pose/         pose model wrapper, keypoint topology, synthetic demo poses
src/coach/        setup checks
src/anatomy/      schematic anatomy layers (bones, muscles, systems), structure catalog, search
src/modes/        bike fit and running gait analysis, reference ranges, reports
src/render/       canvas overlay, teaching overlays and charts
src/presets/      activity presets (data only)
src/ui/, main.ts  Motion Lab interface wiring
src/course/       course projects page: pack encryption, drawing editor, snapshots, synced comparison, export
tests/unit/       Vitest
tests/e2e/        Playwright smoke test
```

## License and credit

Free to use for educational purposes. Commercial use is not permitted, and any alteration needs the
author's written approval. Credit is required: "Real-Time Motion Lab by Timothy Curry", with a link to
this repository. See [LICENSE](LICENSE) for the full terms. To request permission, message
[Timothy Curry on LinkedIn](https://www.linkedin.com/in/health-prof/).

This is a custom source-available license, not an open-source license.

Third-party components (Google's MediaPipe runtime and pose models, Apache 2.0) keep their own
licenses: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The anatomy layers are original
schematic drawings generated in code.
