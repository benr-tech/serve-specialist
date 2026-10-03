/**
 * Splitting a video into clips and checking each clip's camera.
 *
 * Apps like SwingVision export "compilations": several serves joined with hard cuts, and the view
 * often pans/zooms to follow the player. Each clip is analyzed as its own serve, and court
 * measurements are only allowed on clips where the camera holds still.
 */
import type { PoseTrack, Side } from '../pose/types';
import type { SegmentParams } from './params';
import { frameTimes, smoothedKeypoint, speed, torsoLengthPx } from './signals';

export interface Segment {
  /** First frame (inclusive) and last frame (exclusive) in the full track. */
  start: number;
  end: number;
  /** Median half-second background drift (see video/sceneChange.ts); null if unknown. */
  driftMedian: number | null;
  /** True if the view pans or zooms, so a court calibration can't hold for the whole clip. */
  cameraMoving: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1]! : null;
};

/** Frames where a hard cut starts: a single-frame spike in whole-picture change. */
export function findCuts(track: PoseTrack, p: SegmentParams): number[] {
  const full = track.frames.map((f) => f.scene?.full ?? null);
  const cuts: number[] = [];
  for (let i = 1; i < full.length; i++) {
    const v = full[i];
    if (v === null || v === undefined || v < p.cutMinChange) continue;
    const around: number[] = [];
    for (let j = Math.max(0, i - 15); j <= Math.min(full.length - 1, i + 15); j++) {
      const x = full[j];
      if (j !== i && x !== null && x !== undefined) around.push(x);
    }
    const base = median(around);
    const neighboursLow = (full[i - 1] ?? 0) < v / 2 && (full[i + 1] ?? 0) < v / 2;
    if (base !== null && v >= p.cutRatio * base && neighboursLow) cuts.push(i);
  }
  return cuts;
}

export function findSegments(track: PoseTrack, p: SegmentParams): Segment[] {
  const times = frameTimes(track);
  const bounds = [0, ...findCuts(track, p), track.frames.length];
  const segments: Segment[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const start = bounds[k]!, end = bounds[k + 1]!;
    if (end <= start) continue;
    // Too short to hold a serve: merge into the previous clip.
    const prev = segments[segments.length - 1];
    if (prev && times[end - 1]! - times[start]! < p.minClipMs) {
      prev.end = end;
      continue;
    }
    segments.push({ start, end, driftMedian: null, cameraMoving: false });
  }
  for (const s of segments) {
    // Skip the first half-second: its drift compares against frames from before the cut.
    const drift = track.frames
      .slice(s.start, s.end)
      .filter((f) => f.timeMs - times[s.start]! >= 550)
      .map((f) => f.scene?.drift)
      .filter((d): d is number => d !== null && d !== undefined);
    s.driftMedian = median(drift);
    s.cameraMoving = s.driftMedian !== null && s.driftMedian > p.cameraMovingDrift;
  }
  return segments;
}

/** The frames of one clip as their own track (re-indexed from 0, real timestamps kept). */
export function sliceTrack(track: PoseTrack, s: Pick<Segment, 'start' | 'end'>): PoseTrack {
  return { ...track, frames: track.frames.slice(s.start, s.end).map((f, i) => ({ ...f, index: i })) };
}

/**
 * Which arm hits the ball (by the pose model's left/right labels).
 *
 * Primary rule, from the structure of a serve: the tossing hand reaches its highest point first
 * (ball release), and the racket hand reaches its highest point later (contact). Heights are
 * measured from the hips in torso lengths, so camera pan/zoom cancels. Low-visibility points are
 * allowed here because the racket arm is usually blurred at contact.
 *
 * Fallback: the racket arm moves much faster than the tossing arm (speed relative to the shoulders).
 * Returns null if neither rule is clear.
 */
export function detectHittingSide(
  track: PoseTrack,
  smoothingWindow: number,
  minRatio: number,
): { side: Side; method: 'peak_order' | 'speed'; detail: number } | null {
  const torso = torsoLengthPx(track);
  if (!torso) return null;
  const times = frameTimes(track);
  const vis = 0.3;
  const ls = smoothedKeypoint(track, 'leftShoulder', smoothingWindow, vis), rs = smoothedKeypoint(track, 'rightShoulder', smoothingWindow, vis);
  const lh = smoothedKeypoint(track, 'leftHip', smoothingWindow, vis), rh = smoothedKeypoint(track, 'rightHip', smoothingWindow, vis);
  const hipY = lh.y.map((y, i) => (y === null || rh.y[i] === null ? null : (y + rh.y[i]!) / 2));

  const wrist = (side: Side) => smoothedKeypoint(track, `${side}Wrist`, smoothingWindow, vis);
  const peakTime = (side: Side) => {
    const w = wrist(side);
    let best: number | null = null, bestH = -Infinity;
    w.y.forEach((y, i) => {
      if (y === null || hipY[i] === null) return;
      const h = (hipY[i]! - y) / torso; // height above the hips
      if (h > bestH) [best, bestH] = [i, h];
    });
    return best === null ? null : { t: times[best]!, h: bestH };
  };
  const L = peakTime('left'), R = peakTime('right');
  // Both hands must clearly get above the head (≥ 1.3 torso lengths over the hips) for the order to mean anything.
  if (L && R && L.h > 1.3 && R.h > 1.3 && Math.abs(L.t - R.t) >= 150) {
    return { side: L.t > R.t ? 'left' : 'right', method: 'peak_order', detail: Math.abs(L.t - R.t) };
  }

  const peakSpeed = (side: Side) => {
    const w = wrist(side);
    const rel = {
      x: w.x.map((x, i) => (x === null || ls.x[i] === null || rs.x[i] === null ? null : x - (ls.x[i]! + rs.x[i]!) / 2)),
      y: w.y.map((y, i) => (y === null || ls.y[i] === null || rs.y[i] === null ? null : y - (ls.y[i]! + rs.y[i]!) / 2)),
    };
    const sp = speed(rel, times).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return sp.length ? sp[Math.floor(sp.length * 0.95)]! / torso : 0;
  };
  const l = peakSpeed('left'), r = peakSpeed('right');
  if (l === 0 && r === 0) return null;
  const ratio = Math.max(l, r) / Math.max(1e-9, Math.min(l, r));
  return ratio >= minRatio ? { side: l > r ? 'left' : 'right', method: 'speed', detail: ratio } : null;
}
