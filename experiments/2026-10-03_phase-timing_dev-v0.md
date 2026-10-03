# Phase timing on dev-v0 (development check, not an accuracy result)

- **Date:** 2026-10-02/03
- **Data:** `dev-v0` = one SwingVision export, `2026-07-21_filtered-shots.mp4` (sha256 `f2e4df71bdf0365c…`), 7.75 s, 1920×1080, 60 fps, HEVC. Two serves joined by a hard cut; the view pans/zooms to follow the player. Filmed from behind. Not committed (lives in `samples/`).
- **Reference times:** read by eye, frame by frame, from contact sheets. **Not verified against human labels**, so this isn't ground truth.
- **Why it doesn't count as accuracy:** these same two serves were used to find and fix the problems below. An accuracy figure needs held-out, human-labeled serves.
- **Pose model:** MediaPipe `full` (before) / `heavy` (after).
- **Code:** before = analysis params p0.4; after = params p0.7.

## What was found
1. **Upper-body left/right label swaps** (shoulders, elbows, wrists trade labels for ~0.7 s; legs don't). Turned the toss into "contact".
2. **Compilation:** two serves in one file, so "contact = highest wrist in the clip" mixed them up.
3. **Moving view** (SwingVision auto-follow): background drift 7–20 vs 3–5 for a still view, which breaks any court calibration.
4. **Trophy defined as toss-hand peak** (really ball release); ~0.25 s too early.
5. **Racket drop fooled by a low-hanging racket hand** at trophy.
6. **Wrist peaks 33–50 ms before contact** (racket still rising).
7. **Hitting arm misdetected by speed** when the racket arm blurs at contact.

## Results (seconds)

| Serve | Event | Reference (by eye) | Before (p0.4) | After (p0.7) |
|---|---|---|---|---|
| 1 | Trophy | ~2.40 | 1.32 | 2.37 |
| 1 | Racket drop | ~2.65 | 1.33 | 2.63 |
| 1 | Contact | ~2.77 | 1.90 | 2.78 |
| 1 | Landing | ~2.82 | 2.05 | 2.87 |
| 2 | Trophy | ~6.08 | (not separated) | 6.12 |
| 2 | Racket drop | ~6.40 | (not separated) | 6.37 |
| 2 | Contact | ~6.53 | (not separated) | 6.52 |
| 2 | Landing | ~6.60 | (not separated) | 6.67 |

Both clips correctly flagged "camera moving", so foot-fault and court-drive checks are turned off for them with an explanation. The hitting arm was detected as right for both (peak order).

## Open questions
The reference times are by eye, not hand-labeled, and the `contactAfterWristPeakMs = 40` default hasn't been checked on serves that weren't used to set it.
