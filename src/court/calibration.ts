import { applyHomography, solveHomography } from '../geometry/homography';
import type { Mat3, Point } from '../geometry/types';
import { LANDMARKS, REQUIRED_POINTS, type LandmarkId } from './court';

export interface CalibrationClick {
  id: LandmarkId;
  image: Point; // video pixels
}

export interface Calibration {
  clicks: CalibrationClick[];
  /** image px -> court metres */
  imageToCourt: Mat3;
  /** RMS distance (cm) between clicked and fitted landmark positions. Only meaningful with > 4 points. */
  residualCm: number | null;
  /** 'auto' = found by court detection; 'manual' = clicked by the user. */
  source?: 'manual' | 'auto';
  /** For auto: share of the visible court lines that matched line pixels (0-1). */
  autoHitRatio?: number;
}

/**
 * The 4 required clicks go around the singles back box in order, so they must form a convex
 * quadrilateral. A crossed or folded shape means points were clicked in the wrong place or order.
 */
function isConvexQuad(pts: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!, b = pts[(i + 1) % 4]!, c = pts[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

export function calibrate(clicks: CalibrationClick[]): Calibration {
  if (clicks.length < REQUIRED_POINTS) throw new Error(`Need at least ${REQUIRED_POINTS} court points`);
  if (!isConvexQuad(clicks.slice(0, REQUIRED_POINTS).map((c) => c.image))) {
    throw new Error("The first four points don't form a box. One is probably in the wrong spot or order.");
  }
  const src = clicks.map((c) => c.image);
  const dst = clicks.map((c) => LANDMARKS[c.id].court);
  const H = solveHomography(src, dst);
  let residualCm: number | null = null;
  if (clicks.length > REQUIRED_POINTS) {
    const sq = clicks.map((c, i) => {
      const p = applyHomography(H, c.image);
      return (p.x - dst[i]!.x) ** 2 + (p.y - dst[i]!.y) ** 2;
    });
    residualCm = 100 * Math.sqrt(sq.reduce((a, b) => a + b, 0) / sq.length);
  }
  return { clicks, imageToCourt: H, residualCm };
}
