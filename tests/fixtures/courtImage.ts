/**
 * Renders a synthetic court photo (RGBA) through a fixture camera, for testing court detection:
 * white lines on a blue court with green surrounds, plus optional clutter (a dark "player" over the
 * baseline, a wide white wall, speckle noise).
 */
import type { RgbaImage } from '../../src/court/detect';
import { MODEL_LINES } from '../../src/court/detect/fitCourt';
import type { Mat3, Point } from '../../src/geometry/types';
import { mat3Apply } from './syntheticServe';

export interface RenderOptions {
  width?: number;
  height?: number;
  clutter?: boolean;
}

function fillSegment(img: RgbaImage, a: Point, b: Point, thick: number, rgb: [number, number, number]) {
  const { width: w, height: h, data } = img;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - thick)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + thick));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - thick)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + thick));
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2));
      if (Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy)) <= thick / 2) data.set([...rgb, 255], 4 * (y * w + x));
    }
}

export function renderCourt(courtToImage: Mat3, opts: RenderOptions = {}): RgbaImage {
  const w = opts.width ?? 1280, h = opts.height ?? 720;
  const img: RgbaImage = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let i = 0; i < w * h; i++) img.data.set([62, 112, 78, 255], 4 * i); // green surrounds
  // Blue playing surface (doubles court).
  const corners = [{ x: -5.6, y: -0.2 }, { x: 5.6, y: -0.2 }, { x: 5.6, y: 24 }, { x: -5.6, y: 24 }].map((p) => mat3Apply(courtToImage, p));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let inside = true;
      for (let k = 0; k < 4; k++) {
        const p = corners[k]!, q = corners[(k + 1) % 4]!;
        if ((q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x) > 0) inside = false;
      }
      if (inside) img.data.set([48, 82, 140, 255], 4 * (y * w + x));
    }
  // Lines, thicker where they're closer to the camera (5 cm wide on the ground).
  for (const m of MODEL_LINES) {
    const n = 40;
    for (let k = 0; k < n; k++) {
      const pt = (t: number) => (m.kind === 'across' ? { x: m.from + (m.to - m.from) * t, y: m.at } : { x: m.at, y: m.from + (m.to - m.from) * t });
      const a = pt(k / n), b = pt((k + 1) / n);
      const pa = mat3Apply(courtToImage, a), pb = mat3Apply(courtToImage, b);
      const side = m.kind === 'across' ? { x: a.x, y: a.y + 0.05 } : { x: a.x + 0.05, y: a.y };
      const ps = mat3Apply(courtToImage, side);
      const thick = Math.max(1.6, Math.hypot(ps.x - pa.x, ps.y - pa.y));
      fillSegment(img, pa, pb, thick, [236, 238, 235]);
    }
  }
  if (opts.clutter) {
    // A dark "player" standing on the baseline, a white wall in the background, speckles.
    const foot = mat3Apply(courtToImage, { x: 0.3, y: -0.3 });
    for (let y = Math.max(0, Math.round(foot.y - 260)); y < Math.min(h, Math.round(foot.y + 10)); y++)
      for (let x = Math.max(0, Math.round(foot.x - 45)); x < Math.min(w, Math.round(foot.x + 45)); x++) img.data.set([30, 30, 40, 255], 4 * (y * w + x));
    for (let y = 0; y < 40; y++) for (let x = 0; x < w; x++) img.data.set([245, 245, 245, 255], 4 * (y * w + x));
    let seed = 7;
    for (let k = 0; k < 3000; k++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const i = seed % (w * h);
      img.data.set([250, 250, 250, 255], 4 * i);
    }
  }
  return img;
}
