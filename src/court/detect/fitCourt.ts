/**
 * Fit the tennis-court model to detected lines (after Farin et al. 2003).
 *
 * Two detected lines from one direction and two from the other give four intersections. Matching
 * them to two court lines of each direction (e.g. baseline + service line, two sidelines) gives a
 * homography. Each candidate is scored by projecting the whole court and counting how much of it
 * lands on line pixels; the best one wins. The court is symmetric, so the winner is then turned
 * the right way round: not mirrored, and with the server's end where the player stands.
 */
import { applyHomography, invertHomography, solveHomography } from '../../geometry/homography';
import type { Mat3, Point } from '../../geometry/types';
import { COURT, LINE_WIDTH_M } from '../court';
import { fitLine, intersect, type ImageLine } from './lines';

const HALF = LINE_WIDTH_M / 2;
const L = 2 * COURT.baselineToNet; // full court length
const sx = COURT.singlesHalfWidth - HALF;
const dx = COURT.doublesHalfWidth - HALF;
const yBase = HALF, yServ = COURT.baselineToServiceLine - HALF;
const yFarServ = L - COURT.baselineToServiceLine + HALF, yFarBase = L - HALF;

/** Painted lines (line centres), court metres, both halves. */
export const MODEL_LINES: { kind: 'across' | 'along'; at: number; from: number; to: number }[] = [
  { kind: 'across', at: yBase, from: -dx, to: dx },
  { kind: 'across', at: yServ, from: -sx, to: sx },
  { kind: 'across', at: yFarServ, from: -sx, to: sx },
  { kind: 'across', at: yFarBase, from: -dx, to: dx },
  { kind: 'along', at: -dx, from: yBase, to: yFarBase },
  { kind: 'along', at: -sx, from: yBase, to: yFarBase },
  { kind: 'along', at: sx, from: yBase, to: yFarBase },
  { kind: 'along', at: dx, from: yBase, to: yFarBase },
  { kind: 'along', at: 0, from: yServ, to: yFarServ }, // center service line
];
const ACROSS = [yBase, yServ, yFarServ, yFarBase];
const ALONG = [-dx, -sx, sx, dx];

const modelPoint = (m: (typeof MODEL_LINES)[number], t: number): Point =>
  m.kind === 'across' ? { x: m.from + (m.to - m.from) * t, y: m.at } : { x: m.at, y: m.from + (m.to - m.from) * t };

/** Sample points along every model line, for scoring (with the index of the line each belongs to). */
const SAMPLES: Point[] = [];
const SAMPLE_LINE: number[] = [];
MODEL_LINES.forEach((m, li) => {
  const n = m.kind === 'across' ? 40 : 60;
  for (let k = 0; k <= n; k++) { SAMPLES.push(modelPoint(m, k / n)); SAMPLE_LINE.push(li); }
});

/** A fit must be backed by at least this many distinct court lines (both directions), each with this many hits. */
const MIN_SUPPORTING_LINES = 3;
const MIN_HITS_PER_LINE = 12;

export interface CourtFit {
  /** court metres → image px (server's baseline at y = 0, +x to the server's right). */
  courtToImage: Mat3;
  /** Share of the visible projected court lines that land on line pixels (0–1). */
  hitRatio: number;
  /** How many sample points of the court were inside the image. */
  visibleSamples: number;
}

/** Exact homography from 4 point pairs (fast path for the candidate search). Null if degenerate. */
function homography4(src: Point[], dst: Point[]): Mat3 | null {
  const M = new Float64Array(8 * 9);
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!, { x: u, y: v } = dst[i]!;
    M.set([x, y, 1, 0, 0, 0, -x * u, -y * u, u], 18 * i);
    M.set([0, 0, 0, x, y, 1, -x * v, -y * v, v], 18 * i + 9);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r * 9 + c]!) > Math.abs(M[p * 9 + c]!)) p = r;
    if (Math.abs(M[p * 9 + c]!) < 1e-12) return null;
    if (p !== c) for (let k = 0; k < 9; k++) { const t = M[c * 9 + k]!; M[c * 9 + k] = M[p * 9 + k]!; M[p * 9 + k] = t; }
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = M[r * 9 + c]! / M[c * 9 + c]!;
      if (f) for (let k = c; k < 9; k++) M[r * 9 + k]! -= f * M[c * 9 + k]!;
    }
  }
  const h: number[] = [];
  for (let r = 0; r < 8; r++) h.push(M[r * 9 + 8]! / M[r * 9 + r]!);
  return [...h, 1] as Mat3;
}

/**
 * Rejects fits that squash the court: the server's service box area (singles width × baseline to
 * service line) must come out as a real, convex quadrilateral covering some of the picture.
 */
function plausible(H: Mat3, w: number, h: number): boolean {
  const q = [{ x: -sx, y: yBase }, { x: sx, y: yBase }, { x: sx, y: yServ }, { x: -sx, y: yServ }];
  const far = [{ x: -sx, y: yFarBase }, { x: sx, y: yFarBase }, { x: sx, y: yFarServ }, { x: -sx, y: yFarServ }];
  const ok = (quad: Point[]) => {
    const p = quad.map((pt) => {
      const den = H[6] * pt.x + H[7] * pt.y + H[8];
      return den > 1e-9 ? { x: (H[0] * pt.x + H[1] * pt.y + H[2]) / den, y: (H[3] * pt.x + H[4] * pt.y + H[5]) / den } : null;
    });
    if (p.some((v) => !v)) return false;
    const a = Math.abs(area(p as Point[])) / 2;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const u = p[i]!, v = p[(i + 1) % 4]!, t = p[(i + 2) % 4]!;
      const cr = Math.sign((v.x - u.x) * (t.y - v.y) - (v.y - u.y) * (t.x - v.x));
      if (sign === 0) sign = cr;
      else if (cr !== sign) return false;
    }
    return a > 0.003 * w * h;
  };
  // At least one end's service area must be a real quadrilateral (the other may be off-screen).
  return ok(q) || ok(far);
}

const area = (q: Point[]) => q.reduce((a, p, i) => a + p.x * q[(i + 1) % q.length]!.y - q[(i + 1) % q.length]!.x * p.y, 0);

function scoreFit(H: Mat3, dil: Uint8Array, w: number, h: number, stride = 1): { score: number; ratio: number; inside: number; supported: boolean } {
  let hits = 0, inside = 0;
  const perLine = new Array(MODEL_LINES.length).fill(0);
  for (let k = 0; k < SAMPLES.length; k += stride) {
    const s = SAMPLES[k]!;
    const den = H[6] * s.x + H[7] * s.y + H[8];
    if (den <= 1e-9) continue; // behind the camera
    const x = (H[0] * s.x + H[1] * s.y + H[2]) / den, y = (H[3] * s.x + H[4] * s.y + H[5]) / den;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    inside++;
    if (dil[(y | 0) * w + (x | 0)]) { hits++; perLine[SAMPLE_LINE[k]!]++; }
  }
  const backed = MODEL_LINES.map((m, i) => ({ kind: m.kind, ok: perLine[i] * stride >= MIN_HITS_PER_LINE })).filter((l) => l.ok);
  const supported = backed.length >= MIN_SUPPORTING_LINES && backed.some((l) => l.kind === 'across') && backed.some((l) => l.kind === 'along');
  return { score: hits - 0.3 * (inside - hits), ratio: inside ? hits / inside : 0, inside, supported };
}

/**
 * Split lines into the court's two directions by vanishing point: in perspective, lines that are
 * parallel on the court meet at one point in the image (possibly far away). Find the vanishing
 * point most lines agree with, then the best one among the remaining lines.
 */
function twoFamilies(lines: ImageLine[], w: number, h: number): [ImageLine[], ImageLine[]] {
  const center = { x: w / 2, y: h / 2 };
  /** Does line l point at the vanishing point v (homogeneous; z≈0 means "at infinity")? */
  const agrees = (l: ImageLine, v: [number, number, number]) => {
    const dir = { x: -l.b, y: l.a }; // along the line
    const t = -(l.a * center.x + l.b * center.y + l.c);
    const p = { x: center.x + t * l.a, y: center.y + t * l.b }; // point on l nearest the centre
    const to = Math.abs(v[2]) < 1e-9 ? { x: v[0], y: v[1] } : { x: v[0] / v[2] - p.x, y: v[1] / v[2] - p.y };
    const n = Math.hypot(to.x, to.y);
    if (n < 1e-9) return true;
    return Math.abs(dir.x * to.y - dir.y * to.x) / n < Math.sin((2.5 * Math.PI) / 180); // within 2.5°
  };
  const bestFamily = (pool: ImageLine[]) => {
    let best: ImageLine[] = [];
    let bestVotes = 0;
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++) {
        const l = pool[i]!, m = pool[j]!;
        const v: [number, number, number] = [l.b * m.c - m.b * l.c, m.a * l.c - l.a * m.c, l.a * m.b - l.b * m.a];
        const fam = pool.filter((k) => agrees(k, v));
        const votes = fam.reduce((acc, k) => acc + k.votes, 0);
        if (fam.length >= 2 && votes > bestVotes) [best, bestVotes] = [fam, votes];
      }
    return best;
  };
  const first = bestFamily(lines);
  const second = bestFamily(lines.filter((l) => !first.includes(l)));
  return [first, second];
}

/**
 * Does each court line that the fit puts on screen match its own detected line? A fit that piles
 * several court lines onto one real line (a squashed court) fails. Needs `minDistinct` distinct
 * matches, in both directions.
 */
function distinctSupport(H: Mat3, lines: ImageLine[], w: number, h: number, minDistinct = 4): boolean {
  const minLen = 0.12 * Math.min(w, h);
  const used = new Map<number, number>(); // detected line → model line
  let across = 0, along = 0;
  for (let mi = 0; mi < MODEL_LINES.length; mi++) {
    const m = MODEL_LINES[mi]!;
    const pts: Point[] = [];
    for (let k = 0; k <= 30; k++) {
      const pt = modelPoint(m, k / 30);
      const den = H[6] * pt.x + H[7] * pt.y + H[8];
      if (den <= 1e-9) continue;
      const p = { x: (H[0] * pt.x + H[1] * pt.y + H[2]) / den, y: (H[3] * pt.x + H[4] * pt.y + H[5]) / den };
      if (p.x >= 0 && p.y >= 0 && p.x < w && p.y < h) pts.push(p);
    }
    if (pts.length < 2 || Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y) < minLen) continue;
    let bestK = -1, bestD = 3; // px
    lines.forEach((l, k) => {
      const d = pts.reduce((acc, p) => acc + Math.abs(l.a * p.x + l.b * p.y + l.c), 0) / pts.length;
      if (d < bestD) [bestK, bestD] = [k, d];
    });
    if (bestK < 0) continue;
    if (used.has(bestK)) return false; // two court lines on one real line: squashed
    used.set(bestK, mi);
    if (m.kind === 'across') across++; else along++;
  }
  return used.size >= minDistinct && across >= 1 && along >= 1;
}

function pairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i]!, xs[j]!]);
  return out;
}

/** Jacobian determinant of court → image at a court point. Negative = a real (non-mirrored) view from above. */
function orientation(H: Mat3, p: Point): number {
  const e = 0.5;
  const o = applyHomography(H, p), ex = applyHomography(H, { x: p.x + e, y: p.y }), ey = applyHomography(H, { x: p.x, y: p.y + e });
  return (ex.x - o.x) * (ey.y - o.y) - (ex.y - o.y) * (ey.x - o.x);
}

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[3 * i + j]! += a[3 * i + k]! * b[3 * k + j]!;
  return r as Mat3;
};
/** The court's symmetries: identity, mirror left/right, swap ends, rotate 180°. */
const SYMMETRIES: Mat3[] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [-1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, -1, L, 0, 0, 1],
  [-1, 0, 0, 0, -1, L, 0, 0, 1],
];

export interface FitOptions {
  /** Where the player's feet are in the image (any frame near the start). Picks the server's end. */
  feet?: Point | null;
  /** Fallback when feet are unknown: is the camera behind the server or in front? */
  view?: 'behind' | 'front';
  /** Try at most this many lines per direction (strongest first). */
  maxPerFamily?: number;
}

/** Refine a fit by re-fitting each visible court line to the line pixels around its projection. */
function refine(H: Mat3, mask: Uint8Array, w: number, h: number): Mat3 {
  const refined: { m: (typeof MODEL_LINES)[number]; line: { a: number; b: number; c: number } }[] = [];
  for (const m of MODEL_LINES) {
    const xs: number[] = [], ys: number[] = [];
    const n = 80;
    for (let k = 0; k <= n; k++) {
      const p = applyHomography(H, modelPoint(m, k / n));
      // Look a few pixels either side of the projected line for line pixels.
      for (let dy = -3; dy <= 3; dy++)
        for (let dxp = -3; dxp <= 3; dxp++) {
          const x = Math.round(p.x) + dxp, y = Math.round(p.y) + dy;
          if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
          xs.push(x); ys.push(y);
        }
    }
    if (xs.length < 25) continue;
    const line = fitLine(xs, ys);
    if (line) refined.push({ m, line });
  }
  const src: Point[] = [], dst: Point[] = [];
  for (const A of refined.filter((r) => r.m.kind === 'across'))
    for (const B of refined.filter((r) => r.m.kind === 'along')) {
      const cx = B.m.at, cy = A.m.at;
      // Only real corners: the crossing point must lie on both painted segments.
      if (cx < A.m.from - 0.01 || cx > A.m.to + 0.01 || cy < B.m.from - 0.01 || cy > B.m.to + 0.01) continue;
      const p = intersect(A.line, B.line);
      if (p && p.x > -w && p.x < 2 * w && p.y > -h && p.y < 2 * h) { src.push({ x: cx, y: cy }); dst.push(p); }
    }
  if (src.length < 4) return H;
  try {
    const R = solveHomography(src, dst);
    return R;
  } catch {
    return H;
  }
}

export function fitCourt(lines: ImageLine[], mask: Uint8Array, dil: Uint8Array, w: number, h: number, opts: FitOptions = {}): CourtFit | null {
  if (lines.length < 4) return null;
  const maxPer = opts.maxPerFamily ?? 8;
  const [f0, f1] = twoFamilies(lines, w, h);
  const top = (f: ImageLine[]) => [...f].sort((a, b) => b.votes - a.votes).slice(0, maxPer);
  const A = top(f0), B = top(f1);
  if (A.length < 2 || B.length < 2) return null;

  let best: { H: Mat3; score: number } | null = null;
  let bestCoarse = 0;
  const tryFamilies = (across: ImageLine[], along: ImageLine[]) => {
    for (const [l1, l2] of pairs(across))
      for (const [m1, m2] of pairs(along)) {
        const P = [[intersect(l1, m1), intersect(l1, m2)], [intersect(l2, m1), intersect(l2, m2)]];
        if (P.flat().some((p) => !p || p.x < -w || p.x > 2 * w || p.y < -h || p.y > 2 * h)) continue;
        // The four corners must be well apart, or the court collapses onto a single line.
        const minGap = 0.02 * Math.min(w, h);
        const [p00, p01, p10, p11] = [P[0]![0]!, P[0]![1]!, P[1]![0]!, P[1]![1]!];
        const d = (u: Point, v: Point) => Math.hypot(u.x - v.x, u.y - v.y);
        if (d(p00, p01) < minGap || d(p10, p11) < minGap || d(p00, p10) < minGap || d(p01, p11) < minGap) continue;
        for (const [ya, yb] of pairs(ACROSS))
          for (const [xa, xb] of pairs(ALONG))
            for (const swapL of [false, true])
              for (const swapM of [false, true]) {
                const Y = swapL ? [yb, ya] : [ya, yb];
                const X = swapM ? [xb, xa] : [xa, xb];
                const src = [
                  { x: X[0]!, y: Y[0]! }, { x: X[1]!, y: Y[0]! },
                  { x: X[1]!, y: Y[1]! }, { x: X[0]!, y: Y[1]! },
                ];
                const dst = [P[0]![0]!, P[0]![1]!, P[1]![1]!, P[1]![0]!];
                // Only un-mirrored candidates: a mirrored one is just a flipped copy of another.
                if (area(src) * area(dst) >= 0) continue;
                const H = homography4(src, dst);
                if (!H || !plausible(H, w, h)) continue;
                // Cheap pass on every 4th sample first; only promising candidates get the full score.
                const coarse = scoreFit(H, dil, w, h, 4);
                if (coarse.score < 0.8 * bestCoarse) continue;
                bestCoarse = Math.max(bestCoarse, coarse.score);
                const s = scoreFit(H, dil, w, h);
                if (s.inside >= 40 && s.supported && (!best || s.score > best.score) && distinctSupport(H, lines, w, h)) best = { H, score: s.score };
              }
      }
  };
  tryFamilies(A, B);
  tryFamilies(B, A);
  if (!best) return null;

  let H = refine(refine((best as { H: Mat3 }).H, mask, w, h), mask, w, h);

  // Turn it the right way round: a real camera sees the court un-mirrored, and the server's
  // baseline is the end the player stands at (or, failing that, the near/far end by camera view).
  const proper = SYMMETRIES.map((S) => mul(H, S)).filter((G) => orientation(G, { x: 0, y: L / 2 }) < 0);
  const choose = (G: Mat3) => {
    if (opts.feet) {
      try {
        const f = applyHomography(invertHomography(G), opts.feet);
        return -Math.max(0, f.y - 1, -3 - f.y); // 0 when the feet are between 3 m behind and 1 m inside the baseline
      } catch {
        return -Infinity;
      }
    }
    const near = applyHomography(G, { x: 0, y: 0 }).y, far = applyHomography(G, { x: 0, y: L }).y;
    return (opts.view ?? 'behind') === 'behind' ? near - far : far - near;
  };
  if (proper.length) H = proper.reduce((a, b) => (choose(b) > choose(a) ? b : a));
  const s = scoreFit(H, dil, w, h);
  if (!s.supported || !distinctSupport(H, lines, w, h)) return null;
  return { courtToImage: H, hitRatio: s.ratio, visibleSamples: s.inside };
}
