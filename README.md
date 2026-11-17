# Neon Slash

A browser rhythm game where your hands are the controllers: slash neon cubes to the beat with two light sabers driven by webcam hand tracking. No install, no controllers, no video upload.

**Live demo: https://proj2-sigma-one.vercel.app**

- Webcam tracking of both hands with a single-pose neural network (MoveNet Lightning) running in a Web Worker
- Three procedurally synthesized tracks (Synthwave 100 BPM, Electro/House 124 BPM, Drum & Bass 172 BPM) generated with Tone.js; the cube map is derived from the same pattern data as the music
- Three difficulties, practice mode, latency calibration, local best scores
- Three.js scene with bloom, post-processing, combo-driven palettes, hitstop, camera shake and a 4-level auto quality governor
- Everything runs client-side; the video never leaves the device

---

## Quick start (players)

**Requirements**

- A desktop or laptop with a webcam and a recent Chromium-based browser (Chrome/Edge). The fast path uses `MediaStreamTrackProcessor`, WebCodecs `VideoFrame`, `OffscreenCanvas` and (for multithreaded wasm) `SharedArrayBuffer`. Other browsers fall back to a canvas capture path where possible.
- Webcam permission, headphones or speakers.

**How to stand**

- Stand 1-2 m from the camera, both shoulders visible in the upper half of the frame, both hands raised in view.
- The positioning screen shows the camera preview with indicators for each hand and a ring that fills while you hold a valid pose for 1.5 s. It also warns when the room is too dark: turn on a light in front of you.
- Hands are mirrored: your left hand is the red saber, your right hand is the blue saber. "Swap hands" is available in settings.

**Difficulties**

| Difficulty | Rules |
|---|---|
| Easy | One hand per cube pattern, fixed lanes in the middle row, no arrows, minimum 1.0 s between cubes |
| Normal | Both hands, 4 lanes, two rows, no arrows, minimum 0.7 s between cubes (1.2 s per hand) |
| Hard | Arrows (direction cubes), faster cubes, minimum 0.45 s between cubes, occasional double cubes |

**Practice mode**: tick "Practice" on the track select screen. No music; 10 cubes every 2.0 s (any direction), 10 cubes every 1.2 s, then directional cubes (down, right, down, left...) every 1.5 s, alternating hands. A short text explains each miss (too slow, wrong direction, wrong hand, blade passed beside the cube, hand not visible).

**Hotkeys**

| Key | Action |
|---|---|
| `Esc` | Pause/resume in game; back to the main menu from other screens |
| `D` | Toggle the stats overlay (fps, frame breakdown, tracking info) and diagnostic logging |
| `C` | Toggle the camera debug overlay (mirrored video, keypoints, synthetic wrists) |
| `G` | Cycle the tracking backend: CPU (wasm) -> GPU (WebGL) -> WebGPU -> CPU (the same setting is in the gear menu) |

**Webcam tip (Linux)**: many UVC webcams lengthen exposure in auto mode and drop from 30 to ~15 fps in dim light, which directly hurts tracking. Disable it with:

```bash
v4l2-ctl -d /dev/video0 -c exposure_dynamic_framerate=0
```

The game also tries to do this itself: if the measured camera rate is below 27 fps two seconds after start, it switches the track to manual exposure with a capped exposure time (see "Camera exposure lock" below).

---

## Architecture

```
 webcam
   |  getUserMedia 640x480 @30 (candidates: 640x480, 640x360, 1280x720)
   v
 MediaStreamTrack (clone)                     <video> preview (positioning/debug)
   |  MediaStreamTrackProcessor(maxBufferSize=1)
   |  readable stream TRANSFERRED to worker (main thread never touches frames)
   v
 +------------------------ movenet.worker ------------------------+
 | readLoop: read VideoFrame -> "latest" slot (older frame closed) |
 | inferLoop: take latest -> prep (copyTo RGBA / low-light LUT)    |
 |   -> MoveNet SinglePose Lightning (tfjs, wasm x4 SIMD default)  |
 |   -> 8 keypoints (shoulders, elbows, wrists) x,y,score          |
 |   -> postMessage(Float32Array[24], t, inferMs, latency, camFps) |
 +-----------------------------------------------------------------+
   |  result message
   v
 +------------------------- main thread --------------------------+
 | HandTracker.onResult: mirror/scale to game units, y shoulder    |
 |   shift, visibility hysteresis, synthetic wrist from elbow,     |
 |   One Euro filter, forearm direction filter, EMA velocity       |
 | HandTracker.update (every frame): hold/extrapolation +          |
 |   latency-adaptive prediction -> wrist, tip, velocity           |
 |                          |                                      |
 |                          v                                      |
 |  Saber (render smoothing, 3D forward-pointing segment)          |
 |                          |                                      |
 |                          v                                      |
 |  GameEngine.tick: project segment to screen, swept test vs      |
 |  projected cube box, swing speed/direction -> judge             |
 |      |                         |                                |
 |      v                         v                                |
 |  ScoreState / HUD        fx bus (hit/miss/tier/beat/drop)       |
 |      |                         |                                |
 |      v                         v                                |
 |  TrackPlayer (Tone.js)    GameScene (Three.js) render + post    |
 |  hit SFX, music clock     bloom, aberration, quality governor   |
 +-----------------------------------------------------------------+
```

**Worker responsibilities**: reading camera frames, converting them to model input, low-light enhancement, TF.js backend selection and fallback, pose inference, measuring camera fps and frame age. It sends back 24 floats per result (8 keypoints x [x, y, score], normalized to the source frame).

**Main thread responsibilities**: everything time-critical to gameplay and rendering: coordinate mapping, filtering, prediction, saber geometry, hit testing, scoring, audio scheduling (Tone.js), Three.js rendering, UI. Prediction and hold/extrapolation run every render frame, not only on detections, so the saber moves continuously between 20-30 Hz detections.

---

## Hand tracking pipeline

### Model and backends

- **Model**: MoveNet SinglePose Lightning (via `@tensorflow-models/pose-detection`, TF.js 4.22). Thunder is supported by the `POSE_MODEL` constant but is ~2x slower. A local copy at `/models/movenet-lightning/model.json` is used if present (checked with a HEAD request, ignoring HTML fallbacks), otherwise the default TF Hub model is fetched. Built-in smoothing is disabled (`enableSmoothing: false`); `minPoseScore` is 0.2.
- **Input**: `POSE_INPUT_W x POSE_INPUT_H` = 480x360 for the canvas path; in the default `pixels` prep mode the full camera frame is passed as `{data, width, height}` and the library resizes/crops around the person.
- **Warm-up**: 3 dummy inferences on an empty 256x192 canvas before `ready` is reported, so WASM/shader compilation happens before the first real frame.
- **Backend selection** (`pickBackend` in `src/tracking/movenet.worker.ts`). The requested delegate sets the priority order:

  | Delegate (setting) | Order |
  |---|---|
  | CPU (default) | wasm -> webgl -> cpu |
  | GPU | webgl -> wasm -> cpu |
  | WebGPU (experimental) | webgpu (only if `navigator.gpu.requestAdapter()` succeeds) -> wasm -> cpu |

  For `wasm`: if the browser reports multithread support (`WASM_HAS_MULTITHREAD_SUPPORT`, which needs `crossOriginIsolated`), first try threaded SIMD with `threads = clamp(hardwareConcurrency - 2, 2, 4)`; on error or a 6 s timeout, disable multithreading and retry single-threaded (SIMD if available). Every attempt runs a probe tensor op (`mul`) to catch pthread crashes. Errors from late Emscripten sub-workers are swallowed and routed to the current attempt, followed by a 700 ms drain pause so a dead attempt cannot poison the next one. WebGL/WebGPU/CPU attempts use a 15 s timeout.
- WASM binaries are copied to `public/tfjs-wasm/` by `postinstall` and loaded from the same origin (`setWasmPaths`).

### COOP/COEP and `crossOriginIsolated`

Multithreaded WebAssembly needs `SharedArrayBuffer`, which browsers only expose on cross-origin isolated pages. The app therefore sends:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

`credentialless` (instead of `require-corp`) keeps third-party resources without CORP headers loadable. Without these headers the game still works, via single-threaded wasm (slower inference).

### Frame path

1. The camera track is cloned (the `<video>` preview is untouched) and passed to `MediaStreamTrackProcessor` with `maxBufferSize: 1`. The `readable` stream is transferred to the worker; the main thread does not read frames.
2. In the worker, two independent loops run. The **reader loop** continuously reads `VideoFrame`s and stores each in a single `latest` slot, closing the frame it replaces. The **inference loop** takes `latest` immediately (or waits for a wake signal). There is no queue: if inference is slower than the camera, old frames are dropped, so latency does not accumulate. A rate limiter of `1000 / POSE_MAX_FPS - 4` ms (30 fps cap) applies only if the loop is faster than that.
3. **Prep modes** (`POSE_PREP_MODE`, default `pixels`):
   - `pixels`: `VideoFrame.copyTo(RGBA)` into a reused buffer, no canvas involved (falls back to `canvas` if conversion is unsupported)
   - `bitmap`: `createImageBitmap` with resize
   - `canvas`: `drawImage` to an `OffscreenCanvas` of 480x360
4. **Frame age**: measured at receive time from `VideoFrame.timestamp` (absolute if comparable to `performance.now()`, otherwise relative to a sliding-minimum offset with 0.5 ms/s drift) plus the time the frame waited in the slot. Result latency = frame age + worker cycle time; this feeds the predictor. The camera frame interval is also tracked (EMA) as `camFps`.
5. **Fallbacks**: if `MediaStreamTrackProcessor` is unavailable or the stream produces no results within 3 s (watchdog), the main thread captures via `requestVideoFrameCallback` (or rAF) -> `drawImage` -> `getImageData` and posts the buffer to the worker; a single in-flight frame is allowed (`busy` flag), others are skipped.

### Keypoints used

COCO-17 indices from MoveNet are mapped to 8 slots: left/right shoulder (5, 6), elbow (7, 8), wrist (9, 10); the "index finger" slots simply repeat the wrists. Only these are used.

### Mapping to game space

Normalized coordinates are mirrored and stretched so the central `POSE_USEFUL_FRACTION` = 80% of the frame covers the play field (`x` in [-4, 4], `y` in [-2.5, 2.5]). A vertical shift is adapted so the shoulder line sits at game y = `POSE_SHOULDER_Y` = 0.3: the target shift is updated per detection with `POSE_SHIFT_ALPHA` = 0.02 smoothing, only when both shoulder scores exceed `POSE_SHOULDER_MIN` = 0.3.

### Visibility and synthetic wrist

- **Hysteresis**: a wrist appears at score >= `POSE_SCORE_ON` = 0.25 and disappears below `POSE_SCORE_OFF` = 0.12 (also must be inside the frame).
- **Synthetic wrist**: fast swings blur the hand and MoveNet drops the wrist. If elbow and shoulder scores are >= `SYNTH_JOINT_MIN` = 0.3, the wrist is rebuilt as `elbow + last known forearm vector`, for at most `SYNTH_MAX_MS` = 400 ms in a row (the series does not restart until a real wrist is seen). The forearm vector is learned only from real wrists (EMA `FOREARM_ALPHA` = 0.3). Switching between real and synthetic does not jump: the previous output position is kept as an offset that decays with `BLEND_MS` = 150 ms.
- **Hold**: when tracking is lost entirely the hand stays visible for `HAND_HOLD_MS` = 300 ms with velocity decaying exponentially (`HAND_HOLD_TAU_MS` = 100 ms; displacement is the integral of `v * e^(-t/tau)`), then becomes invisible and filters/swing history are reset. When a hand reappears, residual velocity is damped by `exp(-age / VEL_DECAY_TAU_MS)` (100 ms) instead of being zeroed.

### Filtering and prediction

- **Wrist position**: One Euro filter per axis (`ONE_EURO_MIN_CUTOFF` = 1.0, `ONE_EURO_BETA` = 0.4, `ONE_EURO_D_CUTOFF` = 1). Time-based (ms timestamps), so jitter in detection rate does not matter.
- **Forearm direction** (saber orientation): raw unit vector elbow -> wrist (fallback: wrist -> index slot), One Euro per component (`FOREARM_EURO_MIN_CUTOFF` = 0.8, `FOREARM_EURO_BETA` = 0.2), renormalized. Not updated while the wrist is synthetic. Tip = wrist + dir * `SABER_LENGTH` (2.2).
- **Velocity**: EMA over output points (wrist and tip separately), time-constant based: `k = 1 - exp(-dt / VEL_EMA_TAU_MS)` with 80 ms, updated on every detection.
- **Latency-adaptive prediction**: `predictMs = clamp(latencyMs + CAMERA_LATENCY_MS, PREDICT_MIN_MS, PREDICT_MAX_MS)` = clamp(latency + 40, 40, 100) ms, where `latencyMs` is the EMA (alpha 0.2) of frame age + worker cycle. Default is `PREDICT_MS` = 80 until measured. Each render frame the extrapolation horizon is `(min(now - detectedAt, MAX_AGE_MS=100) + predictMs) / 1000` s, and the offset `v * horizon` is clamped to `MAX_PREDICT_UNITS` = 1.0 game unit.
- **Render-side smoothing** (`src/scene/sabers.ts`): the saber handle and tip are exponentially smoothed with `SABER_SMOOTH_TAU_MS` = 35 ms every render frame; the smoothed segment is also what hit testing uses, so what you see is what is judged. On (re)appearance the saber snaps without spring.

### Camera exposure lock

`startCamLock()` runs 2 s after the worker is ready:

1. If measured `camFps >= 27`, do nothing (`auto-ok`).
2. Otherwise switch to manual exposure (needs `exposureMode: manual` and `exposureTime` capabilities, else `unsupported`). The exposure limit is `CAM_MAX_EXPOSURE` = 150 (V4L2 units of 100 us = 15 ms, below a 33 ms frame). Heuristic: if `capabilities.exposureTime.max <= 1000` the scale is probably different (e.g. ms), so the limit is 15% of the reported max instead.
3. After another 2 s, if `camFps < 24` the change is rolled back to continuous exposure.
4. Once locked, a 1 Hz tuner watches frame brightness (luma): below 80 raise exposure (x1.2, up to the cap) and then `brightness` (+8, max 40); above 150 lower brightness, then exposure (x0.85, min 30).

### Low-light enhancement

Mean luma of a 32x24 copy of the frame is computed every `LUMA_EVERY_N` = 10 frames. With hysteresis, enhancement turns on below `LUMA_LOW_ON` = 70 and off above `LUMA_LOW_OFF` = 90. The `lut` mode (default) draws the frame to a canvas, reads `ImageData`, stretches contrast between the 2nd and 98th percentiles of the green channel (minimum span 32) and applies a gamma LUT (`LOWLIGHT_GAMMA` = 0.6). The alternative `filter` mode uses `ctx.filter = brightness(1.4) contrast(1.2)`.

### Production pthread fix (`tfjs-wasm-pthread-fix`)

The threaded tfjs-wasm backend builds the pthread worker source as `'var WasmBackendModuleThreadedSimd = ' + factory.toString()`. The factory references a variable `_scriptDir` declared in the outer IIFE wrapper. After bundling/minification that variable is renamed (e.g. to `e`) and the outer scope does not exist inside the generated blob, so sub-workers died with `ReferenceError: e is not defined` in production builds only (dev worked). The Vite plugin in `vite.config.ts` rewrites `tfjs-backend-wasm-threaded-simd.js` before bundling: removes the `_scriptDir` declarations and replaces every `_scriptDir` with `undefined` (the blob URL is passed through `mainScriptUrlOrBlob`). It is registered both for the main build and for workers (`worker.plugins`). The worker's single-thread fallback exists as a safety net on top of this fix.

---

## Swing and hit detection

### Swing detection

Two detectors exist, with the same semantics:

- `SwingDetector` (`src/tracking/swing.ts`, per hand, on detections): ring buffer of 16 tip samples. Speed is computed over `SWING_WINDOW_MS` = 100 ms (anchor = first sample older than the window; capped by `SWING_MAX_WINDOW_MS` = 150 ms). **peakSpeed** = max speed between consecutive samples within the last 150 ms. **swingDir** = 8-way direction (0 = up, clockwise, 45 degree sectors) of net displacement over `SWING_DIR_WINDOW_MS` = 120 ms, defined only if the path is >= `SWING_DIR_MIN_PATH` = 0.4 units. A jump faster than `SWING_SPEED_MAX` = 25 units/s between fresh samples (<= 100 ms) is treated as an outlier: the position is accepted but speed history is cleared.
- `HandSwing` (`src/game/hit.ts`, per frame, in the engine): keeps 250 ms of tip positions/speeds and computes `peakSpeed`, the exact swing angle (degrees clockwise from up) and `swingDir` over 120 ms with a 0.4 path minimum. It also stores the instantaneous angle of each step (steps shorter than 0.02 units give no angle) for the direction second chance.

### Saber geometry

The saber is a 3D segment pointing into the scene, not a flat 2D line:

- handle `a` = (wrist.x, wrist.y, 0)
- tip `b` = (wrist.x + dir.x * L * `SABER_TILT`, wrist.y + dir.y * L * `SABER_TILT`, -L * `SABER_FORWARD`)

with L = `SABER_LENGTH` = 2.2, `SABER_TILT` = 0.55 (1.21 units along the forearm direction in xy) and `SABER_FORWARD` = 0.85 (1.87 units toward the cubes along -z). The blade therefore reaches into the depth zone where cubes arrive, which matches how a real arm swings toward a screen.

### Hit test

Hit testing is done in **screen space** (`src/game/engine.ts`, `src/game/hit.ts`):

1. Each frame the current saber segment endpoints are projected with the game camera to screen units (`x = NDC.x * aspect`, `y = NDC.y`).
2. For each cube in its zone, the 8 corners of its AABB with half-size `half + HIT_BOX_PAD` (cube size 0.9, so 0.45 + 0.45) are projected; their 2D bounding box, padded by `SCREEN_HIT_PAD` = 0.02, is the target. Doing it in screen space makes the hit match what the player sees regardless of perspective.
3. The test sweeps the segment between the previous and current frame at t = 0, 0.25, 0.5, 0.75, 1 (slab segment-vs-box plus distance from the box center to the segment), so fast swings cannot tunnel through a cube between frames. A 3D variant (`sweepHit3D`) exists in the same file.

### Zones, judging, and guards (`src/game/tuning.ts`)

Cube depth is `z = (songTime - note.time) * CUBE_SPEED` (8 units/s, spawn at z = -24, miss beyond +1.0), recomputed from the same `songTime` that drives judging.

| Constant | Value | Meaning |
|---|---|---|
| `HIT_Z_MIN` | -2.4 | a hit is possible from here (depth zone start) |
| `HIT_Z_MAX` | 1.0 | beyond this the cube is a miss |
| `JUDGE_Z_MIN` | -1.8 | wrong hand / wrong direction penalties only from here; earlier contact is ignored |
| `HIT_Z_PERFECT` | -1.3 | natural contact point (middle of the blade); timing error is measured from it |
| `SWING_SPEED_MIN_HIT` | 3.5 | minimum peak tip speed (units/s) for any hit |
| `WRONG_DIR_SPEED_MULT` | 1.3 | wrong-direction penalty needs peak speed >= 3.5 x 1.3 |
| `DIR_TOLERANCE_DEG` | 75 | angle tolerance for arrow cubes |
| `BACKSWING_MS` | 250 | after a good hit the same hand cannot produce wrongDir (return swing) |
| `DIR_SECOND_CHANCE_MS` | 200 | a recent instantaneous angle that matched the arrow (at hit-level speed) rescues a bad final angle |

Rules per cube while in `HIT_Z_MIN..HIT_Z_MAX` (the owning hand is checked first, then the other hand), requiring the hand to be visible with `peakSpeed >= 3.5` and the swept test to succeed:

- **Other hand** touches it (and `z >= JUDGE_Z_MIN`): `wrongColor`, cube removed, combo reset.
- **Right hand, wrong direction** (arrow cube, angle outside tolerance, no second chance): `wrongDir` only if the swing is fast enough, `z >= JUDGE_Z_MIN` and no good hit in the last 250 ms; otherwise ignored.
- **Otherwise** a good hit. The slice effect direction uses the real swing angle.
- Cube passes `HIT_Z_MAX` untouched: `miss`.

`songTime` = clock time + `latencyOffset` (default `LATENCY_DEFAULT_MS` = 100 ms, adjustable via calibration).

### Scoring (`src/game/score.ts`)

- `timingError = (z - HIT_Z_PERFECT) / CUBE_SPEED` (seconds; positive = late). `acc = max(0, 1 - |error_ms| / 180)`.
- Points per hit = `round(100 + 50 * acc) * multiplier`.
- Multiplier by current combo: x1, x2 from 10, x4 from 20, x8 from 40.
- "Perfect" = |error| < 60 ms (grades: perfect < 60, good < 120, ok otherwise), which drives hit sound layers and effects.
- Any fail (miss, wrong hand, wrong direction) resets combo. Visual combo tiers (palette/saber intensity) are separate: 10, 25, 50.
- Accuracy = hits / total cubes. Best score per track and difficulty is stored in `localStorage` (`ns:` prefix).

---

## Audio and level generation

### Track definition

A track is a `TrackDef` (`src/audio/pattern.ts`): `id`, `name`, `bpm`, optional `scale` (pentatonic notes used for hit bells), a list of `sections`, and a `build(ctx)` function. Each section has a number of bars and 16-character step strings per bar (`'x'` = hit, `'.'` = rest) for `kick`, `snare`, `hat`, plus optional token strings for `bass` / `lead` (16 tokens per bar: `.`, absolute note like `C2`, or a digit 0-3 meaning a chord tone, 3 = tonic an octave up), `chords` (per bar, cycled) and `arp` (16th-note arpeggio over the chord).

Bundled tracks: **Neon Sunset** (synthwave, 100 BPM), **Chrome and Neon** (electro/house, 124 BPM), **Fracture** (drum and bass, 172 BPM) - internal ids `synthwave`, `electro`, `dnb`.

### One source of truth

The same section data produces the sound and the cube map:

- `build(ctx)` schedules `Tone.Part`s on the Transport from `drumEvents` / `noteEvents` / `chordEvents` (absolute times computed from `bpm` and the 16-step grid: `step = 60 / bpm / 4`). Parts are wrapped in a guard that enforces strictly increasing start times (needed by mono synths in Tone.js).
- `buildBeatmap(def, difficulty)` (`src/audio/beatmap.ts`) reads the same `drumEvents`, so every cube lands on a real drum hit. Intro sections are excluded.

### Difficulty rules

| | Events used | Min gap (any cube) | Min gap (same hand) | Arrows | Lanes/rows |
|---|---|---|---|---|---|
| Easy | kicks | 1.0 s | 1.0 s | none | lane 1 (left) / 2 (right), middle row |
| Normal | kicks + snares | 0.7 s | 1.2 s | none | lanes 0-1 left, 2-3 right, rows alternate |
| Hard | kicks + snares + hats (only in chorus/drop, every second) | 0.45 s | 0.45 s | pool `[4, 4, 4, 2, 6, any]` (down-biased) | as Normal, row 1 on every 4th step; double cubes (both hands) at most every 4 s |

Hand assignment: kicks alternate hands; snares/hats take the hand opposite to the previous cube; if that hand is inside its gap, the other one is used, otherwise the event is skipped.

### Determinism

`assignNotes` uses a `mulberry32` PRNG seeded with an FNV-1a hash of `trackId:difficulty` (for custom audio: duration, BPM and difficulty), so a given track/difficulty always produces the same map (and the same personal best is comparable).

### Timing

- The Transport starts after a lead-in; `TrackPlayer.getTime()` = `transport.seconds - lookAhead - outputLatency - leadIn`, i.e. the time actually being heard, negative during the intro. The engine adds `latencyOffset` (tracking latency compensation).
- Lead-in is `INTRO_SEC` = 4 s: an intro riser (filtered noise 200 -> 8000 Hz plus a rising saw sweep) and countdown ticks at 880 Hz for 3, 2, 1 and 1320 Hz on "go", spaced by one beat (or two) folded into 0.5-1 s, all scheduled on the Transport so they are sample-accurate relative to the music. The camera plays a fly-in during the intro.
- Practice mode uses a virtual `PracticeClock` instead of the Transport (pausable).
- Latency calibration (`src/game/calibration.ts`): 4 metronome clicks at 90 BPM on a raw Web Audio oscillator (output latency included); the swing peak near each click is measured and averaged, capped at 350 ms.

### Hit SFX (`src/audio/hitSfx.ts`)

Layered, all nodes created once in the constructor:

- Transient: membrane click (left D3, right G3) + white-noise snap through a 3.5 kHz high-pass; on perfect hits it is 3 dB louder and adds a low "thump" (D2/G2).
- Slice: band-passed noise sweeping 3200 -> 450 Hz (left) / 4400 -> 700 Hz (right), panned -0.4 / +0.4; longer on perfect.
- Bell melody: the note index follows the combo through the scale, so a combo climbs the scale. Non-perfect uses a short dry FM bell; perfect adds a long FM bell with delay (delay time = an eighth of a beat) and two shimmer voices an octave up. Velocity depends on grade (1 / 0.8 / 0.6).
- **Beat quantization**: if the nearest 1/16 grid point of the Transport is within 70 ms (`SNAP_WINDOW`), the bell is delayed to land exactly on it, so hits are musical; otherwise it plays immediately (so input never feels laggy).
- Every 10th combo adds a 3-note 1/32 arpeggio.
- Miss: low membrane body + falling tone; wrong: distorted square, rate-limited to one per 150 ms. Drop impact: sub drop 60 -> 35 Hz plus reverberated noise.
- All voices go through a limiter at -2 dB and a 256-bin FFT analyser used for music reactivity.

### Onset analysis worker (custom tracks)

`src/audio/onset.worker.ts` analyzes decoded audio off the main thread: mono mixdown -> 2048-point Hann-windowed FFT (hop 512) -> log-magnitude spectral flux (positive differences) in three bands (low 30-150 Hz, mid 150-2000 Hz, high 2-8 kHz) -> 3-tap smoothing and 98th-percentile normalization -> adaptive peak picking (local maximum within +/-2 frames, must exceed the local mean over a +/-0.4 s window x 1.3 + 0.1, minimum 100 ms between peaks). BPM comes from autocorrelation of the total-flux envelope (60-200 BPM search in 0.1 steps, harmonics at 2x and 4x lag included, penalty outside 80-160), then a phase scan finds the beat grid. An energy curve at 10 Hz is also produced, used to skip quiet sections and to detect drops (energy rises >1.8x versus the previous 4 s and above the 70th percentile, at most once per 20 s). `buildCustomBeatmap` snaps onsets to the nearest beat within 60 ms, filters by strength per difficulty (0.55 / 0.4 / 0.28), maps low-band onsets to kicks and others to snares and reuses the same `assignNotes`.

Status: the custom-track loader UI is a dev-only feature for now (`import.meta.env.DEV`); production builds only ship the three bundled tracks.

---

## Rendering and effects

- **Scene** (`src/scene/*`): Three.js 0.187, perspective camera (FOV 65, at (0, 1.2, 7) looking at (0, 0.6, -6)), fog, tunnel/floor decor, a judgment line, 500 dust particles, a tunnel wave, saber meshes with additive halo/core and a ribbon trail (12-24 segments by combo tier), cubes with face textures and arrows.
- **No per-frame allocations**: cubes come from a pool of 64; sparks use a 280-particle ring buffer, rings are pooled; trails use preallocated `Float32Array`s with `copyWithin` history shifts; hit code reuses module-level temp vectors and segment objects. The fx bus and `fxState` object are plain mutable structures.
- **Shader warm-up**: `warmUp()` shows one object of each type, runs `renderer.compile` and one render with bloom and the post pass forced on, then restores state, so no shader compile hitch happens in the first seconds of play.
- **fx event bus** (`src/fx/bus.ts`): typed events `beat`, `drop`, `hit`, `miss`, `wrong`, `tier`, `comboBreak`, `introStart`, `trackStart`, with exception-isolated handlers. Continuous **`fxState`** is written every frame and read by everything: `bass` (30-150 Hz FFT energy, fast attack, ~150 ms release), `energy`, `beatPulse` (impulse on each beat, decays with ~180 ms time constant), `tier`, `combo`, `dim`, `hitstop`, `quality`, `intro`.
- **Music reactivity**: beat events come from the drum pattern (bundled tracks) or from analysis (custom); bass/energy come from the live FFT of the actual output. They modulate bloom strength (`x(1 + 0.6 * beatPulse)`), dust size, tunnel wave and decor pulses; drops fire a shake, FOV kick and bloom burst.
- **Combo palettes**: four palettes (violet; magenta/cyan; magenta/amber; orange/white) crossfaded by combo tier (10 / 25 / 50). Saber brightness, halo and trail length also grow with tier, and the core is visible at tier 3.
- **Hitstop**: a perfect hit adds up to 0.06 s of visual lag (cubes render slightly in the past, effects slow to 10% for 50 ms, then lag decays with 25 ms constant); judging still uses the real `songTime`.
- **Camera shake**: value-noise shake (55 Hz), 0.09 on perfect, 0.04 on normal hits, 0.12 on drop, decaying with ~45 ms constant; FOV kick of 1.5 / 3 degrees; intro fly-in from (0, 3, 40) with a small roll.
- **Post pass** (one shader after bloom): chromatic aberration (impulse 0.002 normal hit, 0.004 perfect, 0.006 drop; only at quality 3), vignette (0.25, up to 0.65 when dimmed) and desaturation tied to `dim` after a miss.
- **Bloom**: UnrealBloomPass at half resolution, base strength 1.1.
- **Auto quality** (levels 0-3, `setQuality`):

  | Level | What is on |
  |---|---|
  | 0 | no bloom/post, no sparks, halos on, minimal dust |
  | 1 | + sparks |
  | 2 (default start) | bloom + OutputPass + post pass, no halos |
  | 3 | + chromatic aberration, pixel ratio up to 1.5 |

  Governor (`updateAutoQuality`): drop one level if fps < 50 for 2 s; raise one level if fps >= 58 for 8 s; never above the user ceiling ("Effects": Max / Normal / Minimum).

---

## Performance notes

Measured on an Intel i5-12450H with Intel UHD graphics, Chrome:

| Stage | Cost |
|---|---|
| Pose inference (wasm, 4 threads, SIMD) | ~20-35 ms per frame, in the worker |
| Rendering (Three.js scene + post) | ~1-2 ms per frame on the main thread |
| Game loop | 60 fps |
| Frame prep (`pixels` mode) | small; canvas `drawImage`/`getImageData` paths cost noticeably more on the main thread when used as fallback |

What costs what:

- Inference dominates tracking latency but is off the main thread, so a slow model lowers detection rate, not the frame rate.
- Detection rate is capped by `POSE_MAX_FPS` = 30 and, in practice, by the **webcam frame rate**. **The known bottleneck is webcam fps**: in dim light, auto exposure can halve it (see the exposure tips above). The prediction and hold logic only hide a part of this.
- Low-light enhancement adds a canvas readback + LUT per frame while active.
- Bloom and the post pass are the main GPU cost; quality levels switch them off first.

Use the `D` overlay to see the per-stage breakdown (read / prep / infer / post), camera fps, detection fps, worker threads, luma, exposure state, frame / track / scene times and draw calls.

---

## Project structure

```
src/
  main.ts                 entry point, creates the App
  config.ts               global constants: tracking, filters, camera, field, speeds
  types.ts                shared types (Hand, Dir8, Note, Beatmap, HandState...)
  style.css               UI styles
  tracking/
    poseTracker.ts        HandTracker: camera, worker lifecycle, filters, prediction, exposure lock
    movenet.worker.ts     MoveNet worker: backend selection, frame loops, prep, low-light
    pose.worker.ts        alternative MediaPipe PoseLandmarker worker (POSE_ENGINE = 'mediapipe')
    poseProtocol.ts       worker message types, keypoint slots/indices
    swing.ts              SwingDetector (speed, peakSpeed, swingDir)
    oneEuro.ts            One Euro filter
    smoothing.ts          allocation-free ring buffer
    trackingInfo.ts       shared diagnostics object
    debugView.ts          camera/keypoint debug overlay (C)
    mediapipePoseStub.ts  stub replacing a broken @mediapipe/pose import
  game/
    engine.ts             GameEngine: per-frame loop, spawning, hit judging
    hit.ts                HandSwing, swept segment/box tests, angle matching
    tuning.ts             hit/judge/practice constants
    score.ts              score, combo, multiplier
    practice.ts           practice clock and endless note generator
    calibration.ts        latency calibration metronome and detector
    diag.ts               per-cube diagnostics (window.__nsLog / __nsSummary)
    storage.ts            localStorage best scores and settings
  audio/
    pattern.ts            TrackDef, step patterns, note/chord/drum event builders
    beatmap.ts            beatmap generation, mulberry32 PRNG
    player.ts             TrackPlayer: Transport, lead-in, getTime, fx events, FFT
    hitSfx.ts             layered hit/miss/riser/impact synthesis
    tracks/               bundled tracks: synthwave, electro, dnb
    onset.ts, onset.worker.ts, customTrack.ts   audio analysis and custom tracks
  scene/
    renderer.ts           GameScene: renderer, composer, quality, projection helpers
    cubes.ts, sabers.ts, effects.ts, decor.ts, dust.ts, judgeLine.ts, tunnelWave.ts
    cameraRig.ts          shake, FOV kick, intro fly-in
    postfx.ts             aberration/vignette/desaturation shader
    palette.ts            combo palettes
  fx/bus.ts               event bus and continuous fxState
  ui/
    app.ts                App: screens, input, main loop, hotkeys
    hud.ts, comboBanner.ts, resultCard.ts, positioning.ts, share.ts, analytics.ts
    screens/              main, camera, select, calibration, game, result
public/
  tfjs-wasm/              tfjs wasm binaries (copied by postinstall)
  mediapipe/wasm/         MediaPipe wasm (copied by postinstall)
  _headers                COOP/COEP for Cloudflare Pages
vite.config.ts            dev/preview isolation headers, pthread fix plugin
vercel.json               Vercel headers and caching
```

---

## Development

```bash
npm install        # postinstall copies wasm binaries into public/
npm run dev        # Vite dev server (host exposed, COOP/COEP headers set)
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
npm run preview    # serve dist/ locally with the same isolation headers
```

Test the production build with `npm run build && npm run preview`: the pthread issue described above only appeared in minified output.

**Debug tools**

- `D`: stats overlay and diagnostic logging. `C`: camera/keypoint overlay (synthetic wrists are marked). `G`: switch backend on the fly.
- `window.__nsLog`: array of per-cube records (result, timing error, minimum blade-to-cube distance and when, max speed, direction trace, visibility, depth at hit). Recorded while logging is on (`D`).
- `window.__nsSummary()`: aggregate counts and medians over the session (hit/miss/wrongColor/wrongDir, median timing, miss causes).
- Practice mode prints a human-readable reason for each result.
- Console logs `[cam] settings`, `[cam] capabilities` and `[cam] lock {...}` at startup.

**Tuning**

- `src/config.ts`: field size, cube speed/spawn/miss planes, saber length, camera candidates, tracking and filter parameters, prediction and hold times, low-light and exposure constants, `POSE_ENGINE`, `POSE_DELEGATE`, `POSE_MODEL`, `POSE_PREP_MODE`. A few legacy constants there (for example the older hit pad and tolerance) are superseded by `tuning.ts`.
- `src/game/tuning.ts`: all hit-judging constants (zones, speeds, tolerances, guards, practice timings, screen pad).

---

## Deployment

The app is a static site; any host that can set two response headers works.

- **Vercel** (`vercel.json`): `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on every path; `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` (hashed files), `/tfjs-wasm/*` and `/mediapipe/*`; `Content-Type: application/wasm` for `*.wasm` so streaming compilation works. Build: `npm run build`, output `dist`.
- **Cloudflare Pages**: `public/_headers` (copied to `dist/`) sets the same COOP/COEP headers for all paths.
- **Why COOP/COEP are required**: they make the page cross-origin isolated, which unlocks `SharedArrayBuffer`, needed for multithreaded WebAssembly in TF.js (4 threads is roughly the difference between single-thread inference and the 20-35 ms figure above). Without them the game falls back to single-threaded wasm automatically. Camera access also requires HTTPS (or localhost).

---

## Privacy

Camera frames are processed locally, in the browser, by a model running on your device. Video is not recorded, stored or uploaded. The only data kept is in your browser's `localStorage`: settings, calibration and best scores. (The model file is fetched from the network on first load unless a local copy is hosted.)

---

## Known limitations and roadmap

- **Lighting**: tracking quality depends on light and webcam frame rate; dim rooms and auto-exposure drops (<30 fps) noticeably hurt accuracy. Low-light enhancement and exposure lock help but cannot replace a lit room.
- **Single person**: MoveNet SinglePose tracks one player; other people in frame can steal tracking.
- **Phones and tablets**: not tested. The expected setup is a laptop/desktop webcam; mobile browsers may lack `MediaStreamTrackProcessor` and threaded wasm.
- **Browser support**: tuned for Chromium; Safari/Firefox use fallback paths and are untested.
- **Bundle size**: TF.js, Three.js, Tone.js and wasm binaries make the first load heavy; wasm and assets are cached immutably afterwards. Possible work: lazy-load Three/Tone chunks, drop unused TF.js backends, host the model locally.
- **Custom tracks**: onset analysis and map generation are implemented, but the upload UI is dev-only; shipping it needs input validation, progress/cancel UI and a quality pass on generated maps.
- **WebGPU backend**: experimental, selectable via settings or `G`.
- Roadmap ideas: more bundled tracks, a thunder-model option on strong hardware, difficulty tuning from telemetry, mobile layout.
