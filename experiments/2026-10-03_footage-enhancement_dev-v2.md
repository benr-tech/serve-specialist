# Automatic footage enhancement before pose (levels, upscale, mirror) — negative result

- **Date:** 2026-10-03
- **Question:** Does improving weak video before the pose model (brighter/stretched contrast, 2× upscaling of small videos, tracking a mirrored copy of every frame and merging) make the analysis more accurate?
- **Data:** dev-v2 (5 serves, 4 files; labels in `2026-10-03_phase-labels_dev-v2.json`). Development data only.
- **Method:** MediaPipe `heavy`, every frame (WebCodecs). Variants run by `devtools/enhance.ts` with `devtools/enhanceBackend.ts`; compared by `devtools/variants.dev.ts`: phase error vs labels, median joint jitter (second difference, torso lengths), share of frames with the hitting wrist/elbow visible, left/right label repairs, score. Analysis params p0.10.
  - *levels:* 1st–99th brightness percentile stretched to the full range (gain ≤ 2.5), re-measured every second.
  - *up:* videos with a short side under 1080 px enlarged (≤ 2×, high-quality smoothing).
  - *mirror:* a second landmarker tracks the mirrored frame; joints mapped back, arms and legs matched to the right side, then averaged where both agree (else the more confident one kept).

## Results (mean absolute phase error, s)

| Variant | Start | Trophy | Racket drop | Contact | Landing | Notes |
|---|---|---|---|---|---|---|
| none | 0.088 | 0.063 | 0.039 | 0.035 | 0.030 | |
| levels | 0.111 | 0.121 | 0.077 (1 missed) | 0.162 | 0.140 | dev-v0 #2: 48 label repairs (was 30), contact 0.63 s off |
| up | 0.108 | 0.063 | 0.042 | 0.039 | 0.030 | clip c score 66 → 38 |
| mirror | 0.108 | 0.051 | 0.091 | 0.070 | 0.040 | hitting arm visible more (b: 0.49 → 0.66), joints steadier on b; but repairs 33 → 76 (dev-v0 #1), 10 → 64 (b), b contact 0.27 s early |
| all three | 0.124 | 0.073 | 0.052 (1 missed) | 0.139 | 0.062 | |

## Conclusion
None shipped. Each variant was worse overall than the plain video. The likely reasons: stretching contrast changes what the model was trained on and adds compression noise; upscaling adds no detail (the model already crops and resizes around the player); and the mirrored view disagrees with the normal one exactly where tracking is hard (blurred racket arm), so merging adds errors there instead of removing them. What helped weak footage instead was making the phase detectors themselves robust to it (`2026-10-03_phase-timing_dev-v2.md`).
