# Roomtone

**Draw a room. See sound move through it. Hear it before you build it.**

Roomtone is a browser-based acoustic simulator for real rooms: home studios, living rooms, meeting rooms, chapels, concert halls. Sketch a floor plan, pick wall/floor/ceiling materials, place a sound source and a listener, and Roomtone will:

- **trace tens of thousands of sound rays in 3D** through the room and compute standard acoustic metrics (T20/T30, EDT, C50, C80, D50, critical distance, Schroeder frequency);
- **solve the 2D wave equation** live, so you can *watch* wavefronts reflect, diffract and interfere, and map **standing waves** (bass peaks and nulls) at any frequency;
- **synthesize the room's impulse response** and let you **listen** to a clap, a drum loop, a guitar, your own **microphone** or **any audio file** as if you were standing at the listener position, with instant A/B against the dry signal;
- act as a **treatment advisor**: it scores the room against published targets (EBU Tech 3276, DIN 18041) and fixes problems with one click (absorbers at first-reflection points, corner bass traps, diffusers against flutter echo, enough broadband panels to hit the target RT60).

Everything runs locally in the browser. No server, no account, no API keys.

## Quick start

Requires Node.js ≥ 20 and pnpm (or npm).

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Production build (a static site in `dist/`, deployable to any static host):

```bash
pnpm build
pnpm preview      # http://localhost:4173
```

Tests:

```bash
pnpm test                       # physics/engine unit tests (Vitest)
pnpm build && pnpm preview &    # then, in another shell:
npx playwright install chromium # once
pnpm smoke                      # end-to-end walkthrough with screenshots in test-results/smoke
```

## How to use it

| Action | How |
| --- | --- |
| Reshape the room | Drag corners or whole walls; double-click a wall to add a corner; select a corner and press <kbd>Delete</kbd> to remove it |
| Draw a new room | <kbd>D</kbd>, click corners, <kbd>Enter</kbd> or click the first corner to close |
| Move source / listener | Drag them, or <kbd>S</kbd> / <kbd>L</kbd> and click |
| Mount treatment | <kbd>T</kbd> and click a wall; drag panels along walls; set width, height and material in **Room** |
| Switch visualisation | <kbd>1</kbd> Plan · <kbd>2</kbd> Waves · <kbd>3</kbd> Rays · <kbd>4</kbd> Bass map · <kbd>5</kbd> 3D |
| Listen | **Listen** tab; keep audio playing while you edit to hear the room change |
| Share | **Share** copies a link that contains the whole room (compressed into the URL) |
| Save | <kbd>Ctrl</kbd>+<kbd>S</kbd> saves to this browser; **Projects** also imports and exports `.json` |

Snapping (5 cm grid plus alignment to other corners) is on by default; hold <kbd>Alt</kbd> to disable it.

## Features

- **Plan editor:** polygonal rooms (including non-convex L-shapes), wall dimensions, alignment guides, undo/redo (80 steps), autosave, six templates.
- **Materials:** 19 materials with octave-band absorption (125 Hz – 4 kHz) and scattering coefficients, plus per-panel treatment with real width and height.
- **3D ray tracer** (Web Worker): extruded-prism geometry, specular + Lambertian scattering, air absorption (ISO 9613-1), spherical receiver, 4k / 12k / 40k ray quality modes.
- **Impulse response synthesis:** Poisson-distributed Dirac sequence weighted per octave band (Kuttruff/Vorländer method) with amplitude-complementary band filters; direct sound is exact.
- **Metrics:** T20, T30, EDT, C50, C80, D50, DRR, critical distance, Schroeder frequency, compared side by side with Sabine and Eyring.
- **Wave view:** live 2D FDTD (leapfrog scheme with Kowalczyk–van Walstijn impedance boundaries); impulse or continuous-tone excitation; click anywhere to drop a pulse.
- **Rays view:** 900 sound particles bouncing in real time, with a live echogram at the listener.
- **Bass:** low-frequency response at the listener (20–300 Hz) from FDTD, normalised against a matched-boundary reference; click the curve to see that frequency's standing-wave map.
- **3D view** (Three.js): orbit the extruded room with panels and 140 animated reflection paths.
- **Auralization:** Web Audio convolution with click-free IR hot-swapping; procedural clap/drums/guitar, live microphone, drag-and-drop audio files; A/B against dry; live spectrum/scope.
- **Export:** impulse response as 48 kHz / 24-bit WAV (load it into any convolution reverb in your DAW), audio rendered through the room as WAV, project JSON.
- **Advisor:** room score, five room-use targets, findings with one-click fixes.
- **Responsive** layout down to phone width; keyboard shortcuts (<kbd>?</kbd>).

## Architecture

```
src/
  engine/          pure TypeScript, no DOM: unit-tested physics
    raytrace.ts    3D stochastic ray tracer + visual path sampler
    ir.ts          impulse-response synthesis
    metrics.ts     Schroeder integration, decay times, clarity, Sabine/Eyring
    fdtd.ts        2D wave solver, bass response, standing-wave maps
    reflections.ts image-source early reflections (≤ 2nd order)
    advisor.ts     targets, diagnosis, automatic treatment placement
    geometry.ts, edit.ts, materials.ts, presets.ts, fft.ts
  workers/         Web Worker runner (superseded jobs are terminated)
  audio/           Web Audio graph, procedural test signals, WAV encoder
  state/           Zustand store (history, persistence), simulation wiring, share links
  ui/              React components: canvas stage, HUDs, charts, panels, 3D view
```

Stack: React 19, TypeScript, Vite, Zustand, Three.js, Lucide icons, Geist / Instrument Serif / JetBrains Mono, Vitest, Playwright.

## Limitations (deliberate, documented)

- **Geometry is an extruded floor plan:** walls are vertical, the ceiling is flat. Sloped ceilings, balconies and furniture volumes are not modelled. Furniture can be approximated with wall/floor materials (bookshelf, curtain, seating).
- **Geometric acoustics** (ray tracing) is accurate above roughly the Schroeder frequency; below it, use the bass tools. Diffraction around corners is not in the ray tracer (it is in the wave view), so a fully occluded listener receives no direct sound.
- **The wave and bass simulations are 2D** (a horizontal slice at ear height). Floor–ceiling modes are therefore shown as analytic markers rather than simulated. Wall impedance is frequency-independent within each run.
- **Mono auralization:** a single omnidirectional source and receiver; no HRTF/binaural rendering yet.
- Material data are representative published values, not specific products.
- The microphone source needs headphones to avoid feedback and requires a secure context (https or localhost).
