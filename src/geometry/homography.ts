/**
 * Homography: the 3x3 transform that maps points on one flat plane to another
 * (here: video pixels <-> court metres). Tests: tests/homography.test.ts
 */
import type { Mat3, Point } from './types';

/** Area (x2) of triangle abc; 0 when the three points are on one line. */
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Hartley normalization: move the points so their average is (0, 0) and their average
 * distance from it is sqrt(2). Keeps the numbers in the linear solve close to 1, which makes it
 * far more accurate than working with raw pixel values in the hundreds.
 */
function normalize(pts: Point[]): { T: Mat3; pts: Point[] } {
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const meanDist = pts.reduce((a, p) => a + Math.hypot(p.x - mx, p.y - my), 0) / pts.length;
  const s = meanDist > 0 ? Math.SQRT2 / meanDist : 1;
  return {
    T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1],
    pts: pts.map((p) => ({ x: s * (p.x - mx), y: s * (p.y - my) })),
  };
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const r = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[3 * i + j]! += a[3 * i + k]! * b[3 * k + j]!;
  return r as Mat3;
}

/** Solve A*x = b (A square) by Gauss-Jordan elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[pivot]![c]!)) pivot = r;
    if (Math.abs(M[pivot]![c]!) < 1e-10) throw new Error('Court points are degenerate: cannot fit a homography.');
    [M[c], M[pivot]] = [M[pivot]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/**
 * Find H such that applyHomography(H, src[i]) ~ dst[i].
 * Exactly 4 points: exact fit. More than 4: least-squares fit.
 * Throws if fewer than 4 points, lengths differ, or 3 of 4 points lie on one line.
 */
export function solveHomography(src: Point[], dst: Point[]): Mat3 {
  if (src.length !== dst.length) throw new Error('solveHomography: point lists differ in length.');
  if (src.length < 4) throw new Error('solveHomography: need at least 4 point pairs.');

  const ns = normalize(src);
  const nd = normalize(dst);

  // With exactly 4 points, three on a line makes the problem unsolvable, but the linear solve
  // can still "succeed" and return a broken matrix, so check explicitly.
  if (src.length === 4) {
    for (const pts of [ns.pts, nd.pts]) {
      for (let i = 0; i < 4; i++) {
        const [a, b, c] = pts.filter((_, k) => k !== i) as [Point, Point, Point];
        if (Math.abs(cross(a, b, c)) < 1e-3) throw new Error('Three of the four court points are on one line. Pick points that form a box.');
      }
    }
  }

  // Each pair gives two equations in the 8 unknowns h11..h32 (h33 fixed at 1):
  //   x' = (h11 x + h12 y + h13) / (h31 x + h32 y + 1)  ->  h11 x + h12 y + h13 - h31 x x' - h32 y x' = x'
  const rows: number[][] = [];
  const rhs: number[] = [];
  ns.pts.forEach((s, i) => {
    const d = nd.pts[i]!;
    rows.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
    rhs.push(d.x);
    rows.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
    rhs.push(d.y);
  });
  // Least squares via the normal equations (A^T A)h = A^T b. With 4 points this is the exact solution.
  const AtA = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => rows.reduce((a, r) => a + r[i]! * r[j]!, 0)));
  const Atb = Array.from({ length: 8 }, (_, i) => rows.reduce((a, r, k) => a + r[i]! * rhs[k]!, 0));
  const h = solveLinear(AtA, Atb);

  // Undo the normalization: H = T_dst^-1 * H_normalized * T_src
  const H = multiply(invertHomography(nd.T), multiply([...h, 1] as Mat3, ns.T));
  return H.map((v) => v / H[8]) as Mat3;
}

/** Map one point through H (multiply [x, y, 1], then divide by the third coordinate). */
export function applyHomography(H: Mat3, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/** Inverse transform (court -> image if H is image -> court). Throws if H is singular. */
export function invertHomography(H: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Homography is singular and cannot be inverted.');
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/**
 * How far (cm on the court) a mistake of `errorPx` pixels at image point `p` can move its
 * court position: the largest displacement over 8 compass directions. H maps image px -> court
 * metres. Feeds the foot-fault uncertainty band: far-away feet get wider bands.
 */
export function pixelErrorToCourtCm(H: Mat3, p: Point, errorPx: number): number {
  const center = applyHomography(H, p);
  let worst = 0;
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    const q = applyHomography(H, { x: p.x + errorPx * Math.cos(angle), y: p.y + errorPx * Math.sin(angle) });
    worst = Math.max(worst, Math.hypot(q.x - center.x, q.y - center.y));
  }
  return worst * 100;
}
