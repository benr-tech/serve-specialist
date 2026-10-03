/**
 * Cheap per-frame change measurements, used to find hard cuts (compilation videos) and to tell
 * whether the camera is moving (pan/zoom), which makes court calibration invalid.
 *
 * Each frame is shrunk to 48×27 grayscale and compared with the previous frame:
 * - `full`: mean absolute change over the whole frame (0–255). A cut makes this spike.
 * - `background`: the same, but ignoring a box around the player.
 * - `drift`: background change compared with the frame ~0.5 s earlier (player boxes from both
 *   frames masked). A fixed camera stays near the noise floor; a slow pan or zoom that barely shows
 *   frame to frame adds up here.
 */
import type { Pose } from '../pose/types';

export interface SceneChange {
  full: number;
  background: number | null;
  drift: number | null;
}

type Box = [number, number, number, number];
const DRIFT_MS = 500;

const W = 48;
const H = 27;

export class SceneMeter {
  private ctx: OffscreenCanvasRenderingContext2D;
  private prev: Float32Array | null = null;
  private history: { timeMs: number; gray: Float32Array; box: Box | null }[] = [];

  constructor() {
    this.ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
  }

  /** `pose` (in source pixels) is used to mask out the player; srcW/srcH are the source size. */
  measure(src: CanvasImageSource, srcW: number, srcH: number, pose: Pose | null, timeMs: number): SceneChange | null {
    this.ctx.drawImage(src, 0, 0, W, H);
    const rgba = this.ctx.getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * rgba[4 * i]! + 0.587 * rgba[4 * i + 1]! + 0.114 * rgba[4 * i + 2]!;
    const prev = this.prev;
    this.prev = gray;

    // Player box in the small image, padded by 25 % so limbs and racket stay inside.
    let box: Box | null = null;
    if (pose) {
      const pts = Object.values(pose).filter((k) => k && k.visibility >= 0.3);
      if (pts.length) {
        const xs = pts.map((k) => k.x), ys = pts.map((k) => k.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const px = 0.25 * (x1 - x0) + 0.05 * srcW, py = 0.25 * (y1 - y0) + 0.05 * srcH;
        box = [((x0 - px) / srcW) * W, ((y0 - py) / srcH) * H, ((x1 + px) / srcW) * W, ((y1 + py) / srcH) * H];
      }
    }
    const old = this.history.find((h) => h.timeMs >= timeMs - DRIFT_MS - 20) ?? null;
    this.history.push({ timeMs, gray, box });
    while (this.history.length && this.history[0]!.timeMs < timeMs - DRIFT_MS - 100) this.history.shift();
    if (!prev) return null;

    const outside = (b: Box | null, x: number, y: number) => !b || x < b[0] || x > b[2] || y < b[1] || y > b[3];
    let drift: number | null = null;
    if (old && old.timeMs <= timeMs - DRIFT_MS * 0.8) {
      let sum = 0, n = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!outside(box, x, y) || !outside(old.box, x, y)) continue;
          sum += Math.abs(gray[y * W + x]! - old.gray[y * W + x]!);
          n++;
        }
      }
      drift = n > W * H * 0.15 ? sum / n : null;
    }

    let full = 0, bg = 0, nbg = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = Math.abs(gray[i]! - prev[i]!);
        full += d;
        if (outside(box, x, y)) {
          bg += d;
          nbg++;
        }
      }
    }
    return { full: full / (W * H), background: nbg > W * H * 0.15 ? bg / nbg : null, drift };
  }
}
