# Follow-zoom (crop + enlarge around the player before pose) — negative result

- **Date:** 2026-10-03
- **Question:** When the player is small in the frame, does cropping a box around them and enlarging it to 512×512 before MediaPipe improve the keypoints?
- **Data:** dev-v0 (SwingVision, player ~500 px tall) and dev-v1 clips a, b, c (player 120–170 px tall, 540×960). Development data only.
- **Method:** MediaPipe `heavy`. Variant 1: a single model switching between whole frames and crops. Variant 2: the main model fed only crops once the player is found small, plus a separate `lite` "finder" model on whole frames to re-locate the player when a crop loses them. Metric: share of frames with each keypoint at visibility ≥ 0.5 (devtools/quality.dev.ts), plus checks measured and score (devtools/report.dev.ts).

## Results
| Clip | Hitting wrist visible, no zoom | Variant 2 |
|---|---|---|
| dev-v0 (SwingVision) | 0.77 | 0.76 |
| a | 0.86 | 0.83 |
| b | 0.80 | 0.80 |
| c | 0.36 | 0.00 (tracked the wrong person in the crowd) |

Variant 1 was worse: frames with any detection fell from 203 → 64 (a) and 520 → 335 (b), because switching image framing confused the model's frame-to-frame tracking.

## Conclusion
No gain, plus a new failure mode. Not shipped. Likely reason: in video mode MediaPipe already tracks a region around the person and reads landmarks from the full-resolution pixels there, so the extra crop adds nothing; the real limit is the detail in the file (compression, player size, 30 fps blur). Better footage is the fix (the app's filming tips).
