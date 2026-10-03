# Decisions log

One entry per design decision: what was decided, the alternatives, and why.

---

## D-001 · 2026-10-02 · Start fresh instead of auditing old code
- **Decision:** The old Line Judge code couldn't be found, so the app was rebuilt from scratch, starting from a written design.
- **Alternatives:** Keep looking / reconstruct from memory.
- **Why:** Searching home, Downloads, iCloud turned up nothing. A clean design lets every choice be written down and defended.
- **Status:** Adopted.

## D-002 · 2026-10-02 · Everything runs in the browser
- **Decision:** TypeScript + React + Vite static web app. Pose estimation and analysis run on the user's device. No server.
- **Alternatives:** (a) Python/FastAPI server with GPU pose model; (b) native mobile app.
- **Why:** Videos (often of minors) never get uploaded, so the privacy story is simple. Free static hosting. One language for app + evaluation scripts, so reported numbers come from the same code the app runs. A native app would take much longer to build and needs an app-store install.
- **Cost:** Limited to models that run in a browser; slower on old phones.
- **Status:** Adopted.

## D-003 · 2026-10-02 · MediaPipe Pose Landmarker as default; RTMPose as challenger
- **Decision:** Ship the first version with MediaPipe `pose_landmarker_full` (v1). Keep a pluggable `PoseBackend` interface. Compare against RTMPose-m (26-kpt) using a protocol written before running it.
- **Alternatives:** YOLO11-pose, MoveNet (no toe keypoints; can't judge a foot fault without toes), ViTPose/OpenPose (too heavy or bad license).
- **Why:** MediaPipe has heel + toe points, an official browser runtime, and an Apache license. RTMPose is the strongest browser-feasible challenger with foot points. The decision rule was written before running, so the goalposts can't move afterwards.
- **Status:** Adopted.

## D-004 · 2026-10-02 · Four-way foot-fault verdict with an uncertainty band
- **Decision:** Fault / Legal / Too close to call / Can't tell, with a band computed from calibration click error pushed through the homography.
- **Alternatives:** Binary yes/no with a fixed threshold.
- **Why:** An honest "too close to call" beats a confident wrong answer. It raises precision, and the band shrinks or grows correctly with camera distance.
- **Status:** Adopted.

## D-005 · 2026-10-02 · Pose-model comparison: speed now, accuracy when labeled footage exists
- **Decision:** Run the runtime comparison (MediaPipe lite / full / heavy) now with `bench.html`. Run the accuracy comparison (MediaPipe vs RTMPose-m, protocol written in advance) once `pose-val-v0` has been filmed and labeled.
- **Why:** Accuracy can't be measured without human-labeled serve frames. Speed can.
- **Status:** Adopted.

## D-006 · 2026-10-02 · Manual calibration with 4 required + 2 optional points
- **Decision:** The user clicks the 4 corners of the singles back box. The center mark and T are optional and give a residual (cm) as a calibration-quality check. Court lines are redrawn on the video for a visual check.
- **Alternatives:** Automatic line detection (added later, D-023); 2 baseline points only (not enough for a homography).
- **Why:** Reliable and explainable. Exactly 4 points always fit perfectly, so extra points are the only way to measure calibration error.
- **Status:** Adopted.

## D-007 · 2026-10-02 · Timestamps from the video, not frame counts
- **Decision:** Record each frame's real presentation time and report events in ms.
- **Why:** Phones record variable frame rate, so "frame 90 at 30 fps = 3.0 s" can be wrong.
- **Status:** Adopted.

## D-008 · 2026-10-02 · Decode frames with WebCodecs instead of seeking
- **Decision:** Read the file with `mp4box` and decode every frame with the browser's `VideoDecoder`. Seeking is kept only as a fallback.
- **Alternatives:** Seek + `requestVideoFrameCallback` (first version); a server with ffmpeg (breaks D-002).
- **Why:** Tested on a real clip: seeking found only 74 of 192 frames and some timestamps were stale. WebCodecs got all 192 with exact file timestamps and was 4× faster. Frame-exact timing is required to measure "contact-frame error" honestly.
- **Cost:** One more library (mp4box, BSD-3). Some codecs (e.g. HEVC on older browsers) may fall back to seeking, and the report says so.
- **Status:** Adopted.

## D-009 · 2026-10-02 · Tailwind CSS + shadcn/ui on Vite (not Next.js)
- **Decision:** Restyle the UI with Tailwind 4 and shadcn/ui components (Radix primitives), heavily customized: warm paper/ink palette, grass green, optic-yellow highlight, condensed Archivo display type (self-hosted), soft shadows, eased motion.
- **Alternatives:** Next.js + Tailwind + shadcn; plain CSS (previous version).
- **Why not Next.js:** It's a server-rendering framework, and this app deliberately has no server (D-002). WebCodecs, MediaPipe and canvas are browser-only and would need workarounds for server rendering, with no benefit. Vite is an officially supported shadcn setup. Easy to revisit if a server is ever needed.
- **Status:** Adopted.

## D-010 · 2026-10-02 · Refuse to make a call on untrustworthy input
- **Decision:** No foot-fault call when (a) calibration fit error > 10 cm (≥ 5 points), (b) the 4 required clicks don't form a convex box, or (c) a planted foot measures > 50 cm inside the court.
- **Why:** In testing, random clicks on a non-tennis clip produced a confident "Foot fault, 237 cm over". A judge would catch that in seconds. Saying "can't tell, re-mark the court" is honest.
- **Status:** Adopted. Threshold values are provisional.

## D-011 · 2026-10-02 · Manual contact-frame override
- **Decision:** On the report screen, the user can mark any frame as contact. Phases and the foot-fault window are recomputed around it, and the report says "set by you".
- **Alternatives:** Ball tracking (hard at 30–60 fps, out of scope); trusting the wrist-peak heuristic alone.
- **Why:** Contact anchors everything else. A one-click human correction makes the first version reliable even when the heuristic misses.
- **Status:** Adopted.

## D-012 · 2026-10-02 · Rename to "Serve Specialist"
- **Decision:** The app is now called Serve Specialist. Docs keep "formerly Line Judge" where history matters. The project folder was renamed to `~/serve-specialist` the same day.
- **Status:** Adopted.

## D-013 · 2026-10-02 · Whole-serve analysis as a transparent checklist, not a black-box grade
- **Decision:** Rate the whole serve with 7 named checks measured at specific moments, each with its measurement, a tip, and a "Show me" link to the frame, plus a weighted 0–100 checklist score.
- **Alternatives:** (a) a learned quality model (no labeled data to train or validate it); (b) a single opaque score with no breakdown (unexplainable, can't be checked).
- **Why:** Every number can be traced to one joint angle at one frame, which a coach or judge can verify by looking. Thresholds are versioned in `params.ts` (p0.3), so results are reproducible. Angles use 3D world landmarks to reduce camera-position effects.
- **Risks:** Thresholds are rules of thumb until compared with coach ratings. A high score doesn't mean a good serve, only that the checks passed.
- **Status:** Adopted. Threshold values are provisional.

## D-014 · 2026-10-02 · No disclaimers on the report
- **Decision:** Results are shown without a disclaimer: no "provisional" note under the score and no accuracy footer.
- **Still true:** no accuracy has been measured yet, thresholds are provisional (marked TUNE in params.ts), and every reported number traces to `experiments/`.
- **Status:** Adopted.

## D-015 · 2026-10-02 · Advanced serve metrics (14 checks in 4 areas)
- **Decision:** Add leg drive (knee-extension speed), landing foot, driving into the court, staying side-on, shoulder tilt, hip–shoulder separation, contact height, and pronation. Group checks into Legs & power / Rotation / Arm & contact / Rules, with a score per area. Thresholds in src/analysis/params.ts.
- **How pronation is measured:** the pose model tracks index-knuckle and pinky points. The line across the hand is projected onto the plane perpendicular to the forearm, and its frame-to-frame turn is summed with a sign, so jitter cancels. Skipped below 50 fps (forearm rotation is too fast to follow).
- **Alternatives:** MediaPipe Hand Landmarker for finer hand points (second model, slower, hands are blurred at contact anyway); racket tracking for true racket speed (needs a racket detector that isn't available).
- **Risks:** rotation and pronation rely on the least reliable parts of monocular pose (depth, hands). They're the first to check once labeled serves exist.
- **Status:** Adopted. Threshold values are provisional.

## D-016 · 2026-10-03 · Fixes found on the first real serve video (dev-v0)
- **Decisions:** (1) repair upper/lower-body left/right label swaps; (2) split compilations at hard cuts and analyze each serve separately; (3) measure background drift and turn off court-based checks when the view pans/zooms; (4) detect the hitting arm from the motion (toss hand peaks first, racket hand later), falling back to speed, then to the user's choice; (5) phase heights relative to the hips in torso lengths; (6) trophy = deepest knee bend after ball release (the usual biomechanics definition) instead of toss-hand peak; (7) racket drop only while the elbow is up; (8) contact = wrist peak + 40 ms; (9) Hampel despike + local quadratic smoothing instead of a moving average; (10) MediaPipe `heavy` as default.
- **Why:** each one fixed an actual failure seen on a real SwingVision clip (experiments/2026-10-03_phase-timing_dev-v0.md). Before: contact landed on the toss and trophy was ~1 s early. After: all events within ~1–3 frames of a by-eye reference.
- **Caveats:** tuned on 2 serves, against a by-eye reference not yet verified against human labels. Not yet re-checked on held-out, human-labeled serves. `heavy` is chosen on Google's published accuracy, not a comparison run here yet (D-005).
- **Status:** Adopted.

## D-017 · 2026-10-03 · Host on GitHub Pages (Netlify Drop as alternative)
- **Decision:** Static build with relative asset paths (`base: './'`), so the same `dist/` works on GitHub Pages (sub-path) and Netlify (root). GitHub Actions tests, builds and deploys on push.
- **Alternatives:** Netlify Drop only (manual re-upload every change); Vercel (same idea, another account).
- **Why GitHub:** every push updates the live site automatically, tests must pass before a deploy, and the code and history live in one place. Pages needs a public repo on the free plan, so the planning docs become public too (nothing sensitive in them; checked 2026-10-03).
- **Status:** Adopted.

## D-018 · 2026-10-03 · Redesign five checks that were biased low
- **Problem:** scores sat around 40 even for good serves; on real footage these failed almost every serve, including ones that look fine on video.
- **Changes:**
  - *Arm extension at contact* and *tossing arm*: measured on the 2D image. A straight arm looks straight from any camera angle, while the 3D estimate made straight arms read ~140° (its depth axis is the least certain).
  - *Contact height*: 2D image heights (not foreshortened from behind/side/front), each moment scaled by its own torso length (zoom cancels), using the lower ankle (the back-leg kick was shrinking it).
  - *Elbow at trophy*: upper arm vs the trunk (90° = level with the shoulder line), not vs the ground. Normal shoulder tilt made a good elbow read "49° below".
  - *Racket drop*: elbow angle at the drop (smaller = deeper).
  - *Staying side-on*: total shoulder turn from trophy to contact (staying sideways longer leaves more turn for the swing), instead of penalizing turn before the drop.
- **Effect on dev clips (not an accuracy claim):** SwingVision serves 50 → 83 and 59 → 73. Arm extension at contact reads 178° / 167°, which matches the video.
- **Status:** Adopted. Threshold values are provisional.

## D-019 · 2026-10-03 · Footage-quality tips instead of silent "not measured"
- **Decision:** Each clip gets a footage check: player height in the frame, resolution, fps, moving camera, hitting-arm visibility around contact. Each problem becomes one concrete filming tip on the report.
- **Why:** New development clips (including two pro serves filmed from the stands) were 120–170 px tall, 540×960, often 30 fps and handheld. Most arm checks couldn't be measured, and the user had no idea why.
- **Status:** Adopted.

## D-020 · 2026-10-03 · Front and diagonal-front camera positions
- **Decision:** The court-marking screen asks "Camera is: Behind the server / In front". "In front" turns the court diagram around and phrases left/right as seen in the video. The analysis itself was already view-independent (body-relative heights, label repair, hitting arm from the motion).
- **Also fixed:** videos with a few stray bytes at the end of the file (common after messaging apps) were rejected by the frame-exact reader and silently fell back to the frame-skipping one.
- **Status:** Adopted.

## D-021 · 2026-10-03 · Always give a score, marked "rough" when the footage limits it
- **Decision:** Score once ≥ 25 % of the check weight is measurable (was 60 %). Use arm joints down to 0.3 visibility. Measurements that leaned on faint joints get a "rough" tag, and the overall score says "Rough read" when coverage < 60 %, a third of the weight is rough, or the footage has detail problems (small, low-res, 30 fps, arm hidden).
- **Effect on dev clips:** dev-v1 clips went from "No score" to 69 / 71 / 66, each marked rough with filming tips.
- **Status:** Adopted.

## D-022 · 2026-10-03 · Plainer, darker look
- **Decision:** Dark charcoal theme, one green accent, system sans-serif in bold, pill buttons, plain cards. Dropped the cream background, condensed display font, tilted and overlapping cards, and highlighter stroke. Score shown in a colored ring.
- **Note:** this follows the general style of sports apps without copying SwingVision's logo, name, colors exactly, or assets.
- **Status:** Adopted.

## D-023 · 2026-10-03 · Find the court automatically
- **Decision:** No court-marking step. While analyzing, the app keeps ~12 small stills; for each clip with a still camera it detects the court and uses it for foot-fault and court checks. "Fix the court" / "Mark the court" on the report opens manual marking, which always overrides.
- **Method (classic, explainable; Farin et al. 2003 style):** median of the clip's stills (removes the player) → white-line pixels (bright, unsaturated, brighter than neighbours τ px away on both sides, plus edge coherence to reject foliage) → Hough lines refined by least squares, merged, and kept only if they have a long continuous run → lines grouped by vanishing point → try pairs of lines × pairs of court lines, score each homography by how much of the projected court lands on line pixels → refine on all visible line crossings → turn the right way round (not mirrored; server's end = where the feet are).
- **Safety checks (each added after a real failure):** reject squashed courts (service area must be a real quadrilateral), require ≥ 3 supported court lines in both directions, and require ≥ 4 court lines that each match their *own* detected line. When unsure, it says "couldn't find the court" instead of guessing.
- **Results:** synthetic courts recovered to < 1 px (with player, white wall and noise: < 3 px; positions within 5 cm). Real dev frames: SwingVision 2/2 found correctly; clip A (only ~3 lines visible, far away) and clip C (handheld, side) correctly reported "not found". No accuracy number yet on fixed-camera footage, which needs clips filmed with a fixed phone.
- **Alternatives:** a learned court keypoint model (no browser-ready model or training data); keep manual marking only (an extra step for every user).
- **Status:** Adopted.

## D-024 · 2026-10-03 · Don't upscale or zoom the video before pose estimation
- **Question:** would rescaling or upscaling the video help the pose model?
- **Tested:** follow-zoom (crop + enlarge around the player). No gain on 3 clips, and it tracked the wrong person on the 4th (experiments/2026-10-03_follow-zoom_dev-v1.md). Not shipped.
- **Not tried, on purpose:** super-resolution upscaling. It invents detail (bad for measuring joints) and takes seconds per frame in a browser.
- **Already the case:** frames are analyzed at the file's full resolution; the pose model tracks a box around the player internally.
- **What helps instead:** original files (not texted), 60 fps, player filling more of the frame. The report's filming tips say exactly this.
- **Status:** Adopted.

## D-025 · 2026-10-03 · Sturdier serve phase detection
- **Problem:** on the 5 labeled dev serves, the start landed on pre-serve ball bounces (up to 1.6 s early), landing waited for a still foot (up to 0.3 s late), trophy could pick a knee tucked up in the air, and racket drop went missing when the racket arm wasn't tracked.
- **Decision:** start = beginning of the continuous arm motion into the toss (either wrist ≥ 2 torso lengths/s relative to the hips, ready pause > 70 ms ends it); landing from the hips' fastest fall after contact minus 50 ms; trophy searched only until take-off; racket drop estimated at 115 ms before contact when unseen, with a warning. Params p0.10.
- **Why:** hips are the most reliably tracked joints and their fall/brake is physics, not appearance, so it survives blur, small players and a handheld camera. Arm speed is measured relative to the hips, so camera pans cancel.
- **Effect (dev data, not an accuracy claim):** mean error start 0.66 → 0.09 s, landing 0.14 → 0.03 s, trophy 0.08 → 0.06 s; contact (0.035 s) and racket drop (0.04 s) unchanged (experiments/2026-10-03_phase-timing_dev-v2.md).
- **Status:** Adopted. Thresholds provisional.

## D-026 · 2026-10-03 · No automatic brightening, upscaling or mirror-tracking
- **Question:** can the app fix non-ideal video automatically before tracking it?
- **Tested:** brightness/contrast stretch, 2× upscaling of small videos, tracking a mirrored copy and merging (experiments/2026-10-03_footage-enhancement_dev-v2.md).
- **Result:** each made the phase timing worse overall (contact error 0.035 s → 0.07–0.16 s; up to 6× more left/right label mix-ups). Not shipped; the code stays in `devtools/` so the test can be re-run on new footage.
- **What helps instead:** detectors that tolerate poor footage (D-025), plus the filming tips.
- **Status:** Adopted.

