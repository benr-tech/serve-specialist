/**
 * Keeps a few small still frames while the video is analyzed, for automatic court detection
 * (court/detect). One frame every `everyMs`, at most `max`, shrunk to `maxDim` on the long side.
 */
import type { RgbaImage } from '../court/detect';

export interface Still {
  timeMs: number;
  image: RgbaImage;
  /** still px = video px x scale */
  scale: number;
}

export class StillCollector {
  readonly stills: Still[] = [];
  private last = -Infinity;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(private everyMs = 400, private max = 24, private maxDim = 960) {}

  offer(src: CanvasImageSource, srcW: number, srcH: number, timeMs: number) {
    if (this.stills.length >= this.max || timeMs - this.last < this.everyMs) return;
    this.last = timeMs;
    const scale = Math.min(1, this.maxDim / Math.max(srcW, srcH));
    const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
    if (!this.ctx || this.ctx.canvas.width !== w || this.ctx.canvas.height !== h) {
      this.ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    }
    if (!this.ctx) return;
    this.ctx.drawImage(src, 0, 0, w, h);
    const d = this.ctx.getImageData(0, 0, w, h);
    this.stills.push({ timeMs, image: { width: w, height: h, data: d.data }, scale });
  }
}
