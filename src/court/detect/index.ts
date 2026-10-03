/**
 * Automatic court detection: from one or more still frames to court landmarks in the image.
 * See lines.ts (line pixels, Hough) and fitCourt.ts (model fit). Pure functions on RGBA arrays,
 * so they run in the browser and in tests alike.
 */
import { applyHomography } from '../../geometry/homography';
import type { Point } from '../../geometry/types';
import { CALIBRATION_ORDER, LANDMARKS, type LandmarkId } from '../court';
import { fitCourt, type CourtFit, type FitOptions } from './fitCourt';
import { dilate, houghLines, lineMask, type RgbaImage } from './lines';

export type { RgbaImage } from './lines';

export interface CourtDetection extends CourtFit {
  /** The 6 calibration landmarks in image px, in CALIBRATION_ORDER. */
  landmarks: { id: LandmarkId; image: Point }[];
}

/** Per-pixel median of several frames: removes the moving player, keeps the still court. */
export function medianImage(frames: RgbaImage[]): RgbaImage {
  const { width, height } = frames[0]!;
  const out = new Uint8ClampedArray(width * height * 4);
  const vals = new Uint8Array(frames.length);
  for (let i = 0; i < width * height * 4; i++) {
    if (i % 4 === 3) { out[i] = 255; continue; }
    for (let k = 0; k < frames.length; k++) vals[k] = frames[k]!.data[i]!;
    vals.sort();
    out[i] = vals[vals.length >> 1]!;
  }
  return { width, height, data: out };
}

/** Minimum share of the visible court lines that must sit on line pixels to accept a detection. */
export const MIN_HIT_RATIO = 0.5;

export function detectCourt(img: RgbaImage, opts: FitOptions = {}): CourtDetection | null {
  const { width: w, height: h } = img;
  const mask = lineMask(img);
  const lines = houghLines(mask, w, h);
  const fit = fitCourt(lines, mask, dilate(mask, w, h, 2), w, h, opts);
  if (!fit || fit.hitRatio < MIN_HIT_RATIO) return null;
  return {
    ...fit,
    landmarks: CALIBRATION_ORDER.map((id) => ({ id, image: applyHomography(fit.courtToImage, LANDMARKS[id].court) })),
  };
}
