/**
 * Court-line pixels and straight lines, from one RGBA image.
 *
 * Line pixels follow Farin et al. (2003), the classic tennis court detector: a pixel is a line
 * pixel if it's bright, unsaturated (white) and clearly brighter than the pixels τ steps away on
 * BOTH sides, horizontally or vertically. That keeps thin painted lines and rejects wide white
 * areas (walls, shirts), whose insides have bright neighbours.
 * Straight lines come from a Hough transform, each refined by a total-least-squares fit.
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** A line a*x + b*y + c = 0 with a² + b² = 1, plus how many line pixels support it. */
export interface ImageLine {
  a: number;
  b: number;
  c: number;
  votes: number;
}

export interface LineMaskParams {
  /** Brightness threshold = this percentile of the image's brightness, clamped to [lumFloor, lumCeil]. */
  lumPercentile: number;
  lumFloor: number;
  lumCeil: number;
  /** Line pixels must be this much brighter than their neighbours τ away. */
  contrast: number;
  /** Max (max channel - min channel) for "white". */
  maxSaturation: number;
  /** Neighbour distances (px) to test, covering thin far lines to wide near ones. */
  taus: number[];
  /** Local edge coherence (0-1) a line pixel needs: painted lines have edges all running one way, foliage doesn't. */
  minCoherence: number;
  /** Window radius (px) for the coherence measure. */
  coherenceRadius: number;
}

export const LINE_MASK_DEFAULTS: LineMaskParams = {
  lumPercentile: 0.85,
  lumFloor: 110,
  lumCeil: 190,
  contrast: 15,
  maxSaturation: 80,
  taus: [2, 4, 7],
  minCoherence: 0.45,
  coherenceRadius: 4,
};

/**
 * Edge coherence per pixel from the structure tensor (Sobel gradients, box-averaged): 1 when all
 * edges nearby run in one direction (a painted line), near 0 when they point every way (leaves).
 */
function coherence(lum: Float32Array, w: number, h: number, r: number): Float32Array {
  const n = w * h;
  const W1 = w + 1;
  const ixx = new Float64Array(W1 * (h + 1)), iyy = new Float64Array(W1 * (h + 1)), ixy = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let sxx = 0, syy = 0, sxy = 0;
    for (let x = 0; x < w; x++) {
      let gx = 0, gy = 0;
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const i = y * w + x;
        gx = lum[i - w + 1]! + 2 * lum[i + 1]! + lum[i + w + 1]! - lum[i - w - 1]! - 2 * lum[i - 1]! - lum[i + w - 1]!;
        gy = lum[i + w - 1]! + 2 * lum[i + w]! + lum[i + w + 1]! - lum[i - w - 1]! - 2 * lum[i - w]! - lum[i - w + 1]!;
      }
      sxx += gx * gx; syy += gy * gy; sxy += gx * gy;
      const k = (y + 1) * W1 + x + 1;
      ixx[k] = ixx[k - W1]! + sxx; iyy[k] = iyy[k - W1]! + syy; ixy[k] = ixy[k - W1]! + sxy;
    }
  }
  const box = (I: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    I[(y1 + 1) * W1 + x1 + 1]! - I[y0 * W1 + x1 + 1]! - I[(y1 + 1) * W1 + x0]! + I[y0 * W1 + x0]!;
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r), y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      const a = box(ixx, x0, y0, x1, y1), b = box(iyy, x0, y0, x1, y1), c = box(ixy, x0, y0, x1, y1);
      const tr = a + b;
      out[y * w + x] = tr > 1e-6 ? ((a - b) * (a - b) + 4 * c * c) / (tr * tr) : 0;
    }
  return out;
}

export function lineMask(img: RgbaImage, p: LineMaskParams = LINE_MASK_DEFAULTS): Uint8Array {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const lum = new Float32Array(n);
  const sat = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const r = data[4 * i]!, g = data[4 * i + 1]!, b = data[4 * i + 2]!;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = l;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
    hist[l | 0]!++;
  }
  let acc = 0, pct = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= p.lumPercentile * n) { pct = v; break; }
  }
  const lumMin = Math.min(p.lumCeil, Math.max(p.lumFloor, pct));
  const coh = coherence(lum, w, h, p.coherenceRadius);
  const mask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = lum[i]!;
      if (l < lumMin || sat[i]! > p.maxSaturation || coh[i]! < p.minCoherence) continue;
      for (const t of p.taus) {
        const horiz = x - t >= 0 && x + t < w && l - lum[i - t]! > p.contrast && l - lum[i + t]! > p.contrast;
        const vert = y - t >= 0 && y + t < h && l - lum[i - t * w]! > p.contrast && l - lum[i + t * w]! > p.contrast;
        if (horiz || vert) { mask[i] = 1; break; }
      }
    }
  }
  return mask;
}

/** Grow the mask by `r` pixels (square), so scoring tolerates lines a pixel or two off. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) tmp[y * w + k] = 1;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) out[k * w + x] = 1;
    }
  return out;
}

/** Fit a line through points by total least squares (principal axis). */
function fitLine(xs: number[], ys: number[]): { a: number; b: number; c: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]!; my += ys[i]!; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // Direction = principal eigenvector; the normal is perpendicular to it.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const a = -Math.sin(angle), b = Math.cos(angle);
  return { a, b, c: -(a * mx + b * my) };
}

export interface HoughParams {
  maxLines: number;
  thetaStepDeg: number;
  /** Peaks need at least this many votes, and this share of the strongest peak. */
  minVotes: number;
  minVotesFrac: number;
  /** Suppress other peaks this close to an accepted one. */
  suppressDeg: number;
  suppressPx: number;
  /** Line pixels within this distance refine a line. */
  refineBandPx: number;
  /** A line needs an unbroken run of line pixels at least this long (px), allowing small gaps. */
  minRunPx: number;
}

export const HOUGH_DEFAULTS: HoughParams = {
  maxLines: 24,
  thetaStepDeg: 0.5,
  minVotes: 20,
  minVotesFrac: 0.08,
  suppressDeg: 2.5,
  suppressPx: 8,
  refineBandPx: 2.5,
  minRunPx: 40,
};

/** Longest stretch along the line (within the image) covered by mask pixels, with gaps up to 4 px. */
function longestRun(l: { a: number; b: number; c: number }, mask: Uint8Array, w: number, h: number): number {
  const dir = { x: -l.b, y: l.a };
  const p0 = { x: -l.a * l.c, y: -l.b * l.c }; // point on the line nearest the origin
  const span = Math.hypot(w, h) * 2;
  let best = 0, run = 0, gap = 0, inside = false;
  for (let t = -span; t <= span; t += 1) {
    const x = Math.round(p0.x + t * dir.x), y = Math.round(p0.y + t * dir.y);
    if (x < 0 || y < 0 || x >= w || y >= h) { if (inside) break; continue; }
    inside = true;
    let hit = false;
    for (let d = -1; d <= 1 && !hit; d++) {
      const xx = Math.round(x + d * l.a), yy = Math.round(y + d * l.b);
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) hit = true;
    }
    if (hit) { run += 1 + gap; gap = 0; best = Math.max(best, run); }
    else if (++gap > 4) { run = 0; gap = 0; }
  }
  return best;
}

/** Strongest straight lines in the mask, refined and de-duplicated. */
export function houghLines(mask: Uint8Array, w: number, h: number, p: HoughParams = HOUGH_DEFAULTS): ImageLine[] {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) { xs.push(i % w); ys.push((i / w) | 0); }
  if (xs.length < p.minVotes) return [];
  // Vote with at most ~60k points; refine with all of them.
  const stride = Math.max(1, Math.ceil(xs.length / 60000));
  const nTheta = Math.round(180 / p.thetaStepDeg);
  const diag = Math.ceil(Math.hypot(w, h));
  const nRho = 2 * diag + 1;
  const cos = new Float32Array(nTheta), sin = new Float32Array(nTheta);
  for (let t = 0; t < nTheta; t++) {
    const th = (t * p.thetaStepDeg * Math.PI) / 180;
    cos[t] = Math.cos(th); sin[t] = Math.sin(th);
  }
  const acc = new Int32Array(nTheta * nRho);
  for (let k = 0; k < xs.length; k += stride) {
    const x = xs[k]!, y = ys[k]!;
    for (let t = 0; t < nTheta; t++) acc[t * nRho + Math.round(x * cos[t]! + y * sin[t]!) + diag]!++;
  }

  const lines: ImageLine[] = [];
  const supT = Math.ceil(p.suppressDeg / p.thetaStepDeg);
  let strongest = 0;
  for (let n = 0; n < p.maxLines; n++) {
    let best = -1, bestV = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i]! > bestV) { bestV = acc[i]!; best = i; }
    if (best < 0) break;
    if (n === 0) strongest = bestV;
    if (bestV * stride < p.minVotes || bestV < p.minVotesFrac * strongest) break;
    const t = (best / nRho) | 0, r = (best % nRho) - diag;
    // Suppress the neighbourhood (θ wraps at 180° with ρ -> -ρ).
    for (let dt = -supT; dt <= supT; dt++) {
      let tt = t + dt, sign = 1;
      if (tt < 0) { tt += nTheta; sign = -1; } else if (tt >= nTheta) { tt -= nTheta; sign = -1; }
      for (let dr = -p.suppressPx; dr <= p.suppressPx; dr++) {
        const rr = sign * r + dr + diag;
        if (rr >= 0 && rr < nRho) acc[tt * nRho + rr] = 0;
      }
    }
    // Refine with every mask pixel near the line.
    let a = cos[t]!, b = sin[t]!, c = -r;
    const bx: number[] = [], by: number[] = [];
    for (let k = 0; k < xs.length; k++) {
      if (Math.abs(a * xs[k]! + b * ys[k]! + c) <= p.refineBandPx) { bx.push(xs[k]!); by.push(ys[k]!); }
    }
    const fit = fitLine(bx, by);
    if (fit) ({ a, b, c } = fit);
    if (longestRun({ a, b, c }, mask, w, h) >= p.minRunPx) lines.push({ a, b, c, votes: bx.length });
  }
  return mergeDuplicates(lines, w, h);
}

/**
 * Thick painted lines yield several near-identical Hough lines. Two lines are duplicates if they're
 * within 2° and less than 6 px apart across the image; keep the better-supported one.
 */
function mergeDuplicates(lines: ImageLine[], w: number, h: number): ImageLine[] {
  const kept: ImageLine[] = [];
  const probes = [{ x: w * 0.25, y: h * 0.25 }, { x: w * 0.75, y: h * 0.75 }, { x: w * 0.25, y: h * 0.75 }, { x: w * 0.75, y: h * 0.25 }];
  for (const l of [...lines].sort((p, q) => q.votes - p.votes)) {
    const dup = kept.some((k) => {
      const cosAng = Math.abs(l.a * k.a + l.b * k.b);
      if (cosAng < Math.cos((2 * Math.PI) / 180)) return false;
      // Distance of l from k, measured at points of l near the image.
      return probes.some((p) => {
        const t = -(l.a * p.x + l.b * p.y + l.c);
        const q = { x: p.x + t * l.a, y: p.y + t * l.b }; // p projected onto l
        return q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= h && Math.abs(k.a * q.x + k.b * q.y + k.c) < 6;
      });
    });
    if (!dup) kept.push(l);
  }
  return kept;
}

/** Intersection of two lines, or null if (nearly) parallel. */
export function intersect(l: { a: number; b: number; c: number }, m: { a: number; b: number; c: number }): { x: number; y: number } | null {
  const d = l.a * m.b - l.b * m.a;
  if (Math.abs(d) < 1e-9) return null;
  return { x: (l.b * m.c - m.b * l.c) / d, y: (m.a * l.c - l.a * m.c) / d };
}

export { fitLine };
