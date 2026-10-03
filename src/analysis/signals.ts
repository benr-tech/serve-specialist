/**
 * Turning a PoseTrack into clean time series: gating by visibility, smoothing,
 * speed, and body scale. Shared helpers used by phases.ts and footFault.ts.
 * Missing values are `null` throughout (no person, or keypoint not visible).
 */
import type { KeypointName, PoseTrack } from '../pose/types';

export type Series = (number | null)[];

export interface PointSeries {
  x: Series;
  y: Series;
}

/** Raw x/y of one keypoint per frame; null where not detected or visibility < minVisibility. */
export function keypointSeries(track: PoseTrack, name: KeypointName, minVisibility = 0.5): PointSeries {
  const x: Series = [];
  const y: Series = [];
  for (const f of track.frames) {
    const k = f.pose?.[name];
    const ok = k !== undefined && k.visibility >= minVisibility;
    x.push(ok ? k.x : null);
    y.push(ok ? k.y : null);
  }
  return { x, y };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Hampel filter over ±2 frames: a value is replaced by the local median only if it sits more than
 * 3 robust standard deviations (1.4826 * MAD) away from it. One-frame glitches get removed, while
 * real peaks (which their neighbours lead up to) are left alone. Null stays null.
 */
export function despike(values: Series): Series {
  return values.map((v, i) => {
    if (v === null) return null;
    const near: number[] = [];
    for (let j = i - 2; j <= i + 2; j++) {
      const x = values[j];
      if (x !== null && x !== undefined) near.push(x);
    }
    if (near.length < 4) return v;
    const med = median(near);
    const mad = median(near.map((x) => Math.abs(x - med)));
    return Math.abs(v - med) > 3 * 1.4826 * mad ? med : v;
  });
}

/**
 * Smooths a series in two steps:
 * 1. `despike`: a 3-frame median removes single-frame glitches (e.g. a blurred wrist jumping away).
 * 2. A local polynomial fit (Savitzky-Golay style) over `window` frames: at each frame, fit a
 *    quadratic to the visible neighbours and take its value there. Unlike a moving average this
 *    keeps peaks at their true height and frame, which matters because contact, knee bend and most
 *    angles are read at peaks. With fewer than 5 points it fits a line (same as a moving average).
 * Nulls stay null; gaps are handled by fitting only the points that exist.
 */
export function smooth(values: Series, window: number): Series {
  const clean = despike(values);
  const half = Math.floor(window / 2);
  return clean.map((v, i) => {
    if (v === null) return null;
    const pts: [number, number][] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(clean.length - 1, i + half); j++) {
      const y = clean[j];
      if (y !== null && y !== undefined) pts.push([j - i, y]);
    }
    return fitAtZero(pts, pts.length >= 5 ? 2 : 1);
  });
}

/** Least-squares polynomial of `degree` (1 or 2) through (d, y) points, evaluated at d = 0. */
function fitAtZero(pts: [number, number][], degree: 1 | 2): number {
  if (pts.length === 1) return pts[0]![1];
  // S[k] = Σ d^k, T[k] = Σ y*d^k
  const S = [0, 0, 0, 0, 0];
  const T = [0, 0, 0];
  for (const [d, y] of pts) {
    let p = 1;
    for (let k = 0; k <= 4; k++) {
      S[k]! += p;
      if (k <= 2) T[k]! += y * p;
      p *= d;
    }
  }
  if (degree === 1) {
    const det = S[0]! * S[2]! - S[1]! * S[1]!;
    return Math.abs(det) < 1e-12 ? T[0]! / S[0]! : (T[0]! * S[2]! - S[1]! * T[1]!) / det;
  }
  // Normal equations for y = a + b*d + c*d²; Cramer's rule for a.
  const det3 = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const M = [
    [S[0]!, S[1]!, S[2]!],
    [S[1]!, S[2]!, S[3]!],
    [S[2]!, S[3]!, S[4]!],
  ];
  const D = det3(M);
  if (Math.abs(D) < 1e-12) return fitAtZero(pts, 1);
  return det3([
    [T[0]!, S[1]!, S[2]!],
    [T[1]!, S[2]!, S[3]!],
    [T[2]!, S[3]!, S[4]!],
  ]) / D;
}

export function smoothPoint(p: PointSeries, window: number): PointSeries {
  return { x: smooth(p.x, window), y: smooth(p.y, window) };
}

/** Smoothed keypoint series, what the analysis modules should normally use. */
export function smoothedKeypoint(track: PoseTrack, name: KeypointName, window: number, minVisibility = 0.5): PointSeries {
  return smoothPoint(keypointSeries(track, name, minVisibility), window);
}

/**
 * Image speed (px/s) per frame, by central difference using real timestamps.
 * Uses one-sided differences at the ends or next to gaps; null if no neighbour is available.
 */
export function speed(p: PointSeries, timesMs: number[]): Series {
  const n = p.x.length;
  const out: Series = [];
  const at = (i: number) => (i >= 0 && i < n && p.x[i] !== null && p.y[i] !== null ? i : -1);
  for (let i = 0; i < n; i++) {
    if (at(i) < 0) {
      out.push(null);
      continue;
    }
    const a = at(i - 1) >= 0 ? i - 1 : i;
    const b = at(i + 1) >= 0 ? i + 1 : i;
    if (a === b) {
      out.push(null);
      continue;
    }
    const dt = (timesMs[b]! - timesMs[a]!) / 1000;
    out.push(Math.hypot(p.x[b]! - p.x[a]!, p.y[b]! - p.y[a]!) / dt);
  }
  return out;
}

export function frameTimes(track: PoseTrack): number[] {
  return track.frames.map((f) => f.timeMs);
}

/** Median distance (px) from shoulder midpoint to hip midpoint, the body-size unit for thresholds. */
export function torsoLengthPx(track: PoseTrack, minVisibility = 0.5): number | null {
  const lengths: number[] = [];
  for (const f of track.frames) {
    const p = f.pose;
    if (!p) continue;
    const pts = [p.leftShoulder, p.rightShoulder, p.leftHip, p.rightHip];
    if (pts.some((k) => k.visibility < minVisibility)) continue;
    const sx = (p.leftShoulder.x + p.rightShoulder.x) / 2;
    const sy = (p.leftShoulder.y + p.rightShoulder.y) / 2;
    const hx = (p.leftHip.x + p.rightHip.x) / 2;
    const hy = (p.leftHip.y + p.rightHip.y) / 2;
    lengths.push(Math.hypot(sx - hx, sy - hy));
  }
  if (lengths.length === 0) return null;
  lengths.sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)]!;
}

/** Index of the smallest non-null value in values[from, to), or null if none. */
export function argMin(values: Series, from = 0, to = values.length): number | null {
  let best: number | null = null;
  for (let i = Math.max(0, from); i < Math.min(to, values.length); i++) {
    const v = values[i];
    if (v !== null && v !== undefined && (best === null || v < values[best]!)) best = i;
  }
  return best;
}

/** Index of the largest non-null value in values[from, to), or null if none. */
export function argMax(values: Series, from = 0, to = values.length): number | null {
  return argMin(values.map((v) => (v === null ? null : -v)), from, to);
}

/** First frame index at or after `timeMs`. */
export function frameAtOrAfter(timesMs: number[], timeMs: number): number {
  const i = timesMs.findIndex((t) => t >= timeMs);
  return i < 0 ? timesMs.length : i;
}

/** Odd number of frames spanning about `windowMs`, using the track's median frame interval. */
export function smoothingFrames(track: PoseTrack, windowMs: number): number {
  const t = frameTimes(track);
  const gaps = t.slice(1).map((v, i) => v - t[i]!).sort((a, b) => a - b);
  if (gaps.length === 0) return 1;
  const exact = windowMs / gaps[Math.floor(gaps.length / 2)]!;
  return Math.max(1, 2 * Math.round((exact - 1) / 2) + 1); // nearest odd number
}
