/**
 * Dev-only experiment (not used by the app: none of these helped, see
 * experiments/2026-10-03_footage-enhancement_dev-v2.md). Tries to make weak footage easier for
 * the pose model, without inventing detail:
 * - levels: dim or flat (low-contrast) video is stretched to full brightness range;
 * - upscale: small videos are enlarged with smooth interpolation before tracking;
 * - mirror: every frame is also tracked mirrored, and the two answers are merged (each joint
 *   averaged when both agree, otherwise the more confident one kept). Steadier joints, and the
 *   two views rarely make the same mistake.
 * Keypoints always come back in the original video's pixels.
 */
import type { Detection, Keypoint, KeypointName, Pose, PoseBackend, WorldPose } from '../src/pose/types';
import { KEYPOINT_NAMES } from '../src/pose/types';

export interface EnhanceOptions {
  levels?: boolean;
  /** Enlarge until the short side is at least this many px (0 = never). */
  upscaleToShortSide?: number;
  mirror?: boolean;
}

export const mirrorName = (n: KeypointName): KeypointName =>
  (n.startsWith('left') ? n.replace('left', 'right') : n.startsWith('right') ? n.replace('right', 'left') : n) as KeypointName;

/** Brightness stretch from a small grayscale sample: maps the 1st–99th percentile to the full range. */
export function levelsFor(gray: Uint8ClampedArray | number[]): { lo: number; gain: number } | null {
  const hist = new Array<number>(256).fill(0);
  for (const g of gray) hist[g]!++;
  const n = gray.length;
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]!) >= q * n) return v;
    return 255;
  };
  const lo = pct(0.01), hi = pct(0.99);
  const gain = Math.min(2.5, 255 / Math.max(1, hi - lo));
  // Already uses most of the range: leave it alone.
  if (gain < 1.15 && lo < 20) return null;
  return { lo: lo / 255, gain };
}

const UPPER: KeypointName[] = ['leftShoulder', 'leftElbow', 'leftWrist', 'leftIndex', 'leftPinky'];
const LOWER: KeypointName[] = ['leftHip', 'leftKnee', 'leftAnkle', 'leftHeel', 'leftToe'];

/**
 * The mirrored view sometimes labels the limbs the other way round. For the arms and the legs
 * separately: should `b`'s left/right labels be swapped to match `a`?
 */
export function sideSwaps(a: Pose, b: Pose): [boolean, boolean] {
  return [UPPER, LOWER].map((group) => {
    let same = 0, swapped = 0;
    for (const l of group) {
      const r = mirrorName(l);
      same += Math.hypot(a[l].x - b[l].x, a[l].y - b[l].y) + Math.hypot(a[r].x - b[r].x, a[r].y - b[r].y);
      swapped += Math.hypot(a[l].x - b[r].x, a[l].y - b[r].y) + Math.hypot(a[r].x - b[l].x, a[r].y - b[l].y);
    }
    return swapped < same;
  }) as [boolean, boolean];
}

function applySwaps<T>(rec: Record<KeypointName, T>, [upper, lower]: [boolean, boolean]): Record<KeypointName, T> {
  const out = { ...rec };
  for (const [group, on] of [[UPPER, upper], [LOWER, lower]] as const) {
    if (on) for (const l of group) { const r = mirrorName(l); out[l] = rec[r]; out[r] = rec[l]; }
  }
  return out;
}

/** Merge a pose with one found on the mirrored frame (already mapped back and relabeled). */
export function mergePoses(a: Pose, b: Pose, agreePx: number): Pose {
  const out = {} as Pose;
  for (const n of KEYPOINT_NAMES) {
    const p = a[n], q = b[n];
    if (Math.hypot(p.x - q.x, p.y - q.y) <= agreePx) {
      const wp = Math.max(1e-3, p.visibility), wq = Math.max(1e-3, q.visibility);
      out[n] = { x: (p.x * wp + q.x * wq) / (wp + wq), y: (p.y * wp + q.y * wq) / (wp + wq), visibility: Math.max(p.visibility, q.visibility) };
    } else {
      // Disagreement: keep the more confident answer, but trust it a little less.
      const best = p.visibility >= q.visibility ? p : q;
      out[n] = { ...best, visibility: best.visibility * 0.8 };
    }
  }
  return out;
}

function mergeWorld(a: WorldPose | null, b: WorldPose | null, pose: Pose): WorldPose | null {
  if (!a || !b) return a ?? b;
  const out = {} as WorldPose;
  for (const n of KEYPOINT_NAMES) {
    const p = a[n], q = b[n];
    out[n] = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2, visibility: pose[n].visibility };
  }
  return out;
}

export class EnhancedBackend implements PoseBackend {
  readonly name: string;
  readonly version: string;
  private canvas: OffscreenCanvas | null = null;
  private flipped: OffscreenCanvas | null = null;
  private levels: { lo: number; gain: number } | null = null;
  private levelsAt = -Infinity;
  /** What the last frame needed, for the report. */
  applied = { levels: false, scale: 1, mirror: false };

  constructor(private main: PoseBackend, private mirrorBackend: PoseBackend | null, private opts: EnhanceOptions) {
    this.name = main.name;
    const parts = [opts.levels && 'levels', opts.upscaleToShortSide && `up${opts.upscaleToShortSide}`, mirrorBackend && opts.mirror && 'mirror'].filter(Boolean);
    this.version = `${main.version}+enhance(${parts.join(',') || 'none'})`;
  }

  async init(): Promise<void> {
    await Promise.all([this.main.init(), this.opts.mirror ? this.mirrorBackend?.init() : undefined]);
  }

  /** Re-measure brightness about once a second (lighting can change, e.g. auto-exposure). */
  private updateLevels(source: TexImageSource, w: number, h: number, timeMs: number) {
    if (!this.opts.levels || timeMs - this.levelsAt < 1000) return;
    this.levelsAt = timeMs;
    const sw = 64, sh = Math.max(1, Math.round((64 * h) / w));
    const c = new OffscreenCanvas(sw, sh);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(source as CanvasImageSource, 0, 0, sw, sh);
    const d = x.getImageData(0, 0, sw, sh).data;
    const gray = new Uint8ClampedArray(sw * sh);
    for (let i = 0; i < gray.length; i++) gray[i] = (d[4 * i]! * 77 + d[4 * i + 1]! * 150 + d[4 * i + 2]! * 29) >> 8;
    this.levels = levelsFor(gray);
  }

  detect(source: TexImageSource, w: number, h: number, timeMs: number): Detection | null {
    this.updateLevels(source, w, h, timeMs);
    const short = Math.min(w, h);
    const scale = this.opts.upscaleToShortSide && short < this.opts.upscaleToShortSide ? Math.min(2, this.opts.upscaleToShortSide / short) : 1;
    const mirror = !!(this.opts.mirror && this.mirrorBackend);
    this.applied = { levels: !!this.levels, scale, mirror };
    let input: TexImageSource = source;
    const W = Math.round(w * scale), H = Math.round(h * scale);
    if (this.levels || scale !== 1 || mirror) {
      if (!this.canvas || this.canvas.width !== W || this.canvas.height !== H) this.canvas = new OffscreenCanvas(W, H);
      const ctx = this.canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (this.levels && 'filter' in ctx) {
        // contrast(c) then brightness(b) gives (v - lo) * gain.
        const c = 0.5 / Math.max(0.05, 0.5 - this.levels.lo);
        ctx.filter = `contrast(${c.toFixed(3)}) brightness(${(this.levels.gain / c).toFixed(3)})`;
      } else ctx.filter = 'none';
      ctx.drawImage(source as CanvasImageSource, 0, 0, W, H);
      ctx.filter = 'none';
      input = this.canvas;
    }
    const unscale = (d: Detection | null): Detection | null => {
      if (!d || scale === 1) return d;
      const pose = {} as Pose;
      for (const n of KEYPOINT_NAMES) pose[n] = { ...d.pose[n], x: d.pose[n].x / scale, y: d.pose[n].y / scale };
      return { pose, world: d.world };
    };
    const a = unscale(this.main.detect(input, W, H, timeMs));
    if (!mirror) return a;

    if (!this.flipped || this.flipped.width !== W || this.flipped.height !== H) this.flipped = new OffscreenCanvas(W, H);
    const fx = this.flipped.getContext('2d')!;
    fx.setTransform(-1, 0, 0, 1, W, 0);
    fx.drawImage(input as CanvasImageSource, 0, 0, W, H);
    fx.setTransform(1, 0, 0, 1, 0, 0);
    const m = unscale(this.mirrorBackend!.detect(this.flipped, W, H, timeMs));
    if (!m) return a;
    // Map the mirrored answer back: flip x, and the player's left is the mirrored image's right.
    const back = {} as Pose;
    const backWorld = m.world ? ({} as WorldPose) : null;
    for (const n of KEYPOINT_NAMES) {
      const k: Keypoint = m.pose[mirrorName(n)];
      back[n] = { x: w - k.x, y: k.y, visibility: k.visibility };
      if (backWorld && m.world) {
        const q = m.world[mirrorName(n)];
        backWorld[n] = { x: -q.x, y: q.y, z: q.z, visibility: q.visibility };
      }
    }
    if (!a) return { pose: back, world: backWorld };
    // Agreement radius: a fifth of the shoulder-to-hip length.
    const torso = Math.hypot(
      (a.pose.leftShoulder.x + a.pose.rightShoulder.x - a.pose.leftHip.x - a.pose.rightHip.x) / 2,
      (a.pose.leftShoulder.y + a.pose.rightShoulder.y - a.pose.leftHip.y - a.pose.rightHip.y) / 2,
    );
    const swaps = sideSwaps(a.pose, back);
    const pose = mergePoses(a.pose, applySwaps(back, swaps), Math.max(4, 0.2 * torso));
    return { pose, world: mergeWorld(a.world, backWorld && applySwaps(backWorld, swaps), pose) };
  }

  close(): void {
    this.main.close();
    this.mirrorBackend?.close();
  }
}
