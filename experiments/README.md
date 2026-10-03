# Experiments

Each measured number in the project traces to a file in this folder: the script, a named dataset version, the raw output, and the date/machine.

## Datasets
| Version | Contents | Use | Notes |
|---|---|---|---|
| `smoke-v0` | 1 clip, 8 s, 24 fps, 1280×720, sha256 `ac5513…dd86`. **Not a tennis serve** (a person walking toward the camera). Not committed (lives in `samples/`). | Runtime and pipeline smoke tests only | Can't support any accuracy claim |
| `dev-v0` | 1 SwingVision export (2 serves, 60 fps, moving view), sha256 `f2e4df71…`. Not committed. | **Development only**: finding and fixing failure modes | Used for tuning, so it can never be a test set |
| `dev-v1` | 3 clips, 2026-10-03: `a` (amateur player, far, front-diagonal, 30 fps), `b` and `c` (pro matches filmed from the stands, handheld). All 540×960. Hashes `36f08725…`, `70c493cc…`, `2d740d3e…`. Not committed. | **Development only** | Footage too small/low-res for most arm checks |
| `dev-v2` | dev-v0 + dev-v1 = 5 serves, with by-eye phase labels (`2026-10-03_phase-labels_dev-v2.json`) | **Development only** | Labels by one person, ±1–2 frames |
| `pose-val-v0` | *planned:* 10–20 serves × 4 frames, human-labeled feet + wrists | Pose-model accuracy comparison | Not collected yet |

## Log
| Date | File | Question | Result | Caveats |
|---|---|---|---|---|
| 2026-10-03 | `2026-10-03_phase-timing_dev-v2.md` | Are the serve phases timed right on all 5 dev serves? | No: start up to 1.6 s early (pre-serve bounces), landing up to 0.3 s late, one trophy 0.29 s late (leg tuck in the air). After 4 fixes, mean error start 0.66 → 0.09 s, landing 0.14 → 0.03 s, trophy 0.08 → 0.06 s, contact 0.035 s, racket drop 0.04 s | Same serves used for tuning; one labeler |
| 2026-10-03 | `2026-10-03_footage-enhancement_dev-v2.md` | Does brightening, upscaling or mirror-tracking the video first help? | No: every variant was worse overall (e.g. contact error 0.035 → 0.07–0.16 s). Not shipped | Dev data; 5 serves |
| 2026-10-03 | `2026-10-03_follow-zoom_dev-v1.md` | Does cropping + enlarging around a small player improve pose? | No: hitting-wrist visibility unchanged (0.77→0.76, 0.86→0.83, 0.80→0.80) and one clip locked onto a spectator. Not shipped | Dev data; 4 clips |
| 2026-10-03 | (DECISIONS D-023, `devtools/courtViz.ts`) | Can the court be found automatically? | Synthetic: corners < 1 px (clean), < 3 px with clutter, positions < 5 cm. Real dev frames: SwingVision 2/2 correct; dev-v1 clips a and c "not found" (too few lines / handheld side view) instead of a wrong court | Few real frames; fixed-camera footage still needed |
| 2026-10-03 | (DECISIONS D-018) | Why do scores sit around 40? | Five checks were biased low (3D depth error, wrong reference for "elbow height", back-leg kick in contact height…). After the redesign: dev-v0 serves 50 → 83 and 59 → 73. dev-v1 clips: most arm checks unmeasurable (player 120–170 px tall, 540×960, 30 fps) → "No score" plus filming tips | Dev data, thresholds still TUNE |
| 2026-10-03 | `2026-10-03_phase-timing_dev-v0.md` | Do the phase detectors work on a real serve video? | No, at first (contact on the toss, trophy 1 s early); after 7 fixes, all events within ~1–3 frames of a by-eye reference | Reference not human-verified; same clip used for tuning. Not an accuracy claim. |
| 2026-10-02 | `2026-10-02_pose-runtime_smoke-v0.json` | How fast is each MediaPipe variant in the browser? | Pose inference, median ms/frame: lite 5.4, full 6.6, heavy 17.0. All detected a person in 192/192 frames. | One clip, one machine, one browser. Speed only, says nothing about accuracy. Excludes model download time. |

### What it means
Even `heavy` runs at ~17 ms/frame, so a 10 s, 60 fps clip (600 frames) takes ~10 s. Speed isn't a reason to avoid the heavier model, so `heavy` is the default (DECISIONS D-016). The accuracy comparison on `pose-val-v0` will show whether it's actually better on feet and wrists.
