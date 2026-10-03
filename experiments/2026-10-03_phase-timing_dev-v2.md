# Phase timing on dev-v2 (development check, not an accuracy result)

- **Date:** 2026-10-03
- **Data:** `dev-v2` = 5 serves: the 2 dev-v0 serves (SwingVision, 60 fps, from behind) and the 3 dev-v1 clips (`a`: amateur, front-diagonal, 30 fps; `b`, `c`: pros filmed from the stands, handheld, 60/30 fps, 540×960).
- **Reference times:** by eye, frame by frame, from contact sheets made with `devtools/sheet.ts` (same decoder and timestamps as the analysis). Labels and definitions: `2026-10-03_phase-labels_dev-v2.json`. Not verified by a second person.
- **Why it doesn't count as accuracy:** the detectors were changed while looking at these same serves. An accuracy figure needs held-out, human-labeled serves.
- **Script:** `devtools/phases.dev.ts`. **Code:** before = params p0.9, after = p0.10.

## What was wrong
1. **Start** was the toss hand's lowest point in the 2 s before release. On clips with pre-serve ball bounces it landed on a bounce: 1.1–1.6 s early.
2. **Landing** waited for a foot to be still for 50 ms. Feet slide and roll after touchdown and the tracked feet are noisy at landing, so it was 0.05–0.3 s late.
3. **Trophy** (deepest knee bend after release) could pick a knee tucked up *in the air* after take-off (clip b, 0.29 s late).
4. **Racket drop** was missing when the racket arm isn't tracked behind the back (clip a).

## Changes
1. Start = the first frame of continuous arm motion leading into the toss: from the toss arm's fastest moment, walk back while either wrist moves ≥ 2 torso lengths/s relative to the hips; a pause > 70 ms is the ready position.
2. Landing from the hips: they speed up as they fall and brake once the legs take the weight. Landing = the hips' fastest fall after contact minus 50 ms (no clear fall = no jump).
3. Trophy search ends 50 ms before take-off (the hips' fastest rise).
4. Racket drop, when the arm can't be seen: 115 ms before contact, with a warning.

## Results (detected − reference, seconds)

| Serve | Start | Trophy | Racket drop | Contact | Landing |
|---|---|---|---|---|---|
| dev-v0 #1 | −0.05 → −0.12 | −0.03 → −0.03 | −0.02 → −0.02 | +0.01 → +0.01 | +0.05 → −0.02 |
| dev-v0 #2 | −0.12 → −0.23 | +0.04 → +0.04 | −0.03 → −0.03 | −0.01 → −0.01 | +0.07 → +0.02 |
| a | −1.57 → +0.03 | −0.04 → −0.04 | missing → +0.06 | +0.03 → +0.03 | +0.07 → +0.03 |
| b | −0.44 → −0.04 | +0.29 → +0.19 | +0.06 → +0.06 | +0.08 → +0.08 | +0.21 → +0.01 |
| c | −1.12 → −0.02 | −0.02 → −0.02 | −0.02 → −0.02 | +0.03 → +0.03 | +0.30 → +0.07 |
| **Mean abs. error** | **0.66 → 0.09** | **0.08 → 0.06** | **0.03 → 0.04** (1 missing → 0) | **0.035 → 0.035** | **0.14 → 0.03** |

"Before" values use the corrected labels (dev-v0 starts 1.00 / 5.00, clip a landing 5.50).

## Caveats
- Clip b's trophy is still 0.19 s late: its 3D knee angle keeps deepening into the racket drop, later than the classic trophy pose. Trophy as "deepest knee bend" and trophy as "the pose" disagree on this serve.
- On dev-v0 the racket arm starts moving ~0.1–0.2 s before the hands visibly separate, and the detector counts that as the start.
- 50 ms (landing) and 2 torso lengths/s (start) were chosen on these 5 serves.
