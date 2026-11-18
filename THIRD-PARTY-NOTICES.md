# Third-party notices

Real-Time Motion Lab's own code, documentation and anatomy drawings are covered by the
[LICENSE](LICENSE) in this repository. The components below belong to others and remain under
their own licenses.

## Distributed with the deployed site

| Component | Use | License |
|---|---|---|
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), Google LLC | Pose-estimation runtime (JavaScript and WebAssembly) | Apache License 2.0 |
| MediaPipe Pose Landmarker models (lite, full, heavy), Google LLC | Pose-estimation model files, downloaded at build time | Apache License 2.0 |
| jsPDF 4.2.1 (`jspdf`), James Hall and contributors | PDF export in the course projects page | MIT License |
| fflate, canvg, html2canvas, core-js, `@babel/runtime` and canvg's small dependencies (bundled by jsPDF; most load only if needed) | Compression and drawing support inside jsPDF | MIT License |
| DOMPurify (bundled by jsPDF, loaded only if needed) | HTML sanitising inside jsPDF | Apache License 2.0 or Mozilla Public License 2.0 (dual) |

The Apache License 2.0 is available at https://www.apache.org/licenses/LICENSE-2.0.
The MIT License text is included in each package's source distribution.
These components are redistributed unmodified.

## Development tools (not distributed with the site)

Vite, TypeScript and Vitest (MIT / Apache 2.0), and Playwright (Apache 2.0).

## Published data and methods

The app implements published methods and uses published numerical values, cited in
`public/methods.html`. These include body-segment parameters from de Leva (1996) and filtering
methods described by Winter (2009). Citations acknowledge the sources; the app's license does
not claim any rights in them.
