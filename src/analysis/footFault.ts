/**
 * Baseline foot-fault rule. Tests: tests/footFault.test.ts
 */
import { applyHomography, pixelErrorToCourtCm } from '../geometry/homography';
import type { Mat3, Point } from '../geometry/types';
import type { PoseTrack, Side } from '../pose/types';
import type { FootFaultParams } from './params';
import { frameTimes, smoothedKeypoint, speed, torsoLengthPx, type PointSeries, type Series } from './signals';

export type Verdict = 'fault' | 'legal' | 'too_close' | 'cant_tell';

export interface FootSample {
  grounded: boolean;
  /** Most forward point of the foot (court metres). */
  front: Point;
  /** Distance behind the baseline in cm. Positive = behind the line (safe). */
  marginCm: number;
  /** Uncertainty band at this foot position, cm. */
  bandCm: number;
}

export interface FootFaultResult {
  verdict: Verdict;
  /** One sentence explaining the verdict, shown in the report. */
  reason: string;
  /** Smallest margin over grounded frames in the window (cm), or null if none. */
  minMarginCm: number | null;
  /** Band at the frame of minMarginCm (cm). */
  bandCm: number | null;
  /** Foot and frame where minMarginCm happened. */
  foot: Side | null;
  frameIndex: number | null;
  /** Total ms of grounded, visible foot data in the window. */
  groundedMs: number;
  /** Per-frame samples for the overlay; null where the foot isn't visible. */
  samples: { frameIndex: number; left: FootSample | null; right: FootSample | null }[];
}

export interface FootFaultInput {
  track: PoseTrack;
  /** image px → court metres */
  imageToCourt: Mat3;
  /** Window is [startFrame, contactFrame). */
  startFrame: number;
  contactFrame: number | null;
  params: FootFaultParams;
  smoothingWindow: number;
}

interface FootSeries {
  toe: PointSeries;
  heel: PointSeries;
  /** Toe speed in torso-lengths per second. */
  speed: Series;
}

/**
 * Grounded = toe still at frame i AND for groundedPadMs on both sides. The padding stops the
 * first frames of push-off (foot already lifting, but still slow) from counting: a lifted toe
 * projects forward through the ground-plane homography and would look like it crossed the line.
 */
function isGrounded(s: Series, times: number[], i: number, p: FootFaultParams): boolean {
  for (let j = i; j >= 0 && times[i]! - times[j]! <= p.groundedPadMs; j--) {
    if (s[j] === null || s[j]! >= p.groundedSpeed) return false;
  }
  for (let j = i; j < times.length && times[j]! - times[i]! <= p.groundedPadMs; j++) {
    if (s[j] === null || s[j]! >= p.groundedSpeed) return false;
  }
  return true;
}

function noCall(reason: string): FootFaultResult {
  return { verdict: 'cant_tell', reason, minMarginCm: null, bandCm: null, foot: null, frameIndex: null, groundedMs: 0, samples: [] };
}

export function judgeFootFault({ track, imageToCourt: H, startFrame, contactFrame, params: p, smoothingWindow: w }: FootFaultInput): FootFaultResult {
  if (contactFrame === null) return noCall('Ball contact wasn\'t found, so there\'s no "before contact" window to check.');
  const torso = torsoLengthPx(track);
  if (!torso) return noCall("The player's body wasn't visible clearly enough.");

  const times = frameTimes(track);
  const feet: Record<Side, FootSeries> = { left: footSeries('left'), right: footSeries('right') };
  function footSeries(side: Side): FootSeries {
    const toe = smoothedKeypoint(track, `${side}Toe`, w, p.minVisibility);
    const heel = smoothedKeypoint(track, `${side}Heel`, w, p.minVisibility);
    return { toe, heel, speed: speed(toe, times).map((v) => (v === null ? null : v / torso!)) };
  }

  const samples: FootFaultResult['samples'] = [];
  let groundedMs = 0;
  let closest: { marginCm: number; bandCm: number; foot: Side; frame: number } | null = null;
  let overSince: number | null = null; // first frame of the current run of "clearly over the line"
  let fault = false;

  for (let i = startFrame; i < contactFrame; i++) {
    const row: FootFaultResult['samples'][number] = { frameIndex: i, left: null, right: null };
    let anyGrounded = false;
    let anyOver = false;

    for (const side of ['left', 'right'] as const) {
      const f = feet[side];
      if (f.toe.x[i] == null || f.heel.x[i] == null) continue;
      const toeImg = { x: f.toe.x[i]!, y: f.toe.y[i]! };
      const toe = applyHomography(H, toeImg);
      const heel = applyHomography(H, { x: f.heel.x[i]!, y: f.heel.y[i]! });
      const forward = toe.y >= heel.y ? toe : heel;
      const front = { x: forward.x, y: forward.y + p.shoeTipOffsetM };
      const marginCm = -100 * front.y;
      const bandCm = pixelErrorToCourtCm(H, toeImg, p.clickErrorPx) + p.keypointAllowanceCm;
      const grounded = isGrounded(f.speed, times, i, p);
      row[side] = { grounded, front, marginCm, bandCm };

      if (grounded) {
        anyGrounded = true;
        if (!closest || marginCm < closest.marginCm) closest = { marginCm, bandCm, foot: side, frame: i };
        if (marginCm < -bandCm) anyOver = true;
      }
    }

    const frameMs = (times[i + 1] ?? times[i]!) - times[i]!;
    if (anyGrounded) groundedMs += frameMs;
    if (anyOver) {
      overSince ??= i;
      if (times[i]! + frameMs - times[overSince]! >= p.faultMinMs) fault = true;
    } else {
      overSince = null;
    }
    samples.push(row);
  }

  const base = {
    minMarginCm: closest?.marginCm ?? null,
    bandCm: closest?.bandCm ?? null,
    foot: closest?.foot ?? null,
    frameIndex: closest?.frame ?? null,
    groundedMs,
    samples,
  };
  if (!closest || groundedMs < p.minGroundedMs) {
    return { ...base, verdict: 'cant_tell', reason: "The feet weren't visible and planted long enough before contact to judge." };
  }
  if (closest.marginCm < -p.implausibleOverCm) {
    return {
      ...base,
      verdict: 'cant_tell',
      reason: `A planted foot measured ${Math.round(-closest.marginCm)} cm inside the court, which isn't a real serve stance. The court points are probably marked wrong.`,
    };
  }
  if (fault) {
    return { ...base, verdict: 'fault', reason: 'A planted foot touched or crossed the baseline before the ball was hit.' };
  }
  if (closest.marginCm > closest.bandCm) {
    return { ...base, verdict: 'legal', reason: 'Both feet stayed behind the baseline until the ball was hit.' };
  }
  return { ...base, verdict: 'too_close', reason: 'A foot came within the measurement uncertainty of the line, so this can\'t be called either way.' };
}
