/**
 * Dev-only contact sheets for labeling serve phases by eye. In the dev server's page console:
 *   const m = await import('/devtools/sheet.ts'); await m.sheet('2026-10-03_a', 4.5, 6.0);
 * Decodes every frame (same decoder and timestamps as the analysis), crops around the player
 * using the saved track, and saves samples/sheets/<name>_<t0>-<t1>.png with each frame's time.
 */
import type { PoseBackend, PoseTrack } from '../src/pose/types';
import { decodePoseTrack } from '../src/video/decodeFrames';

const VIDEOS: Record<string, string> = {
  '2026-07-21_filtered-shots': '/samples/2026-07-21_filtered-shots.mp4',
  '2026-10-03_a': '/samples/2026-10-03_a.mov',
  '2026-10-03_b': '/samples/2026-10-03_b.mov',
  '2026-10-03_c': '/samples/2026-10-03_c.mov',
};

const noPose: PoseBackend = { name: 'none', version: '0', init: async () => {}, detect: () => null, close: () => {} };

/** Player box (px) from the saved track around time t: union of visible keypoints over ±0.5 s. */
function playerBox(track: PoseTrack, t: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of track.frames) {
    if (!f.pose || Math.abs(f.timeMs - t) > 500) continue;
    for (const k of Object.values(f.pose)) {
      if (k.visibility < 0.5) continue;
      x0 = Math.min(x0, k.x); x1 = Math.max(x1, k.x); y0 = Math.min(y0, k.y); y1 = Math.max(y1, k.y);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export async function sheet(name: string, t0: number, t1: number, { cols = 8, thumbH = 260, every = 1 } = {}): Promise<string> {
  const track = (await (await fetch(`/samples/tracks/${name}.json`)).json()) as PoseTrack;
  const blob = await (await fetch(VIDEOS[name]!)).blob();
  const file = new File([blob], name);
  const mid = ((t0 + t1) / 2) * 1000;
  const b = playerBox(track, mid) ?? { x0: 0, y0: 0, x1: track.videoWidth, y1: track.videoHeight };
  const h = b.y1 - b.y0;
  // Room above for the toss and racket, and to the sides for the swing.
  const crop = { x: b.x0 - 0.6 * h, y: b.y0 - 0.9 * h, w: b.x1 - b.x0 + 1.2 * h, h: 2.05 * h };
  const thumbW = Math.round((thumbH * crop.w) / crop.h);
  const picked: { t: number; i: number; bmp: ImageBitmap }[] = [];
  let n = 0;
  await decodePoseTrack(file, noPose, {
    onFrame: (f, img) => {
      if (f.timeMs < t0 * 1000 - 1 || f.timeMs > t1 * 1000 + 1) return;
      if (n++ % every) return;
      const c = new OffscreenCanvas(thumbW, thumbH);
      c.getContext('2d')!.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, thumbW, thumbH);
      picked.push({ t: f.timeMs, i: f.index, bmp: c.transferToImageBitmap() });
    },
  });
  const rows = Math.ceil(picked.length / cols);
  const out = new OffscreenCanvas(cols * thumbW, rows * (thumbH + 22));
  const x = out.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, out.width, out.height);
  x.font = 'bold 18px monospace';
  picked.forEach((p, k) => {
    const cx = (k % cols) * thumbW, cy = Math.floor(k / cols) * (thumbH + 22);
    x.drawImage(p.bmp, cx, cy + 22);
    x.fillStyle = '#ff0';
    x.fillText(`${(p.t / 1000).toFixed(3)}  #${p.i}`, cx + 4, cy + 17);
  });
  const png = await out.convertToBlob({ type: 'image/png' });
  const label = `${name}_${t0.toFixed(2)}-${t1.toFixed(2)}`;
  await fetch(`/__dev/save-sheet?name=${label}`, { method: 'POST', body: png });
  return `${label}: ${picked.length} frames, crop ${crop.w.toFixed(0)}×${crop.h.toFixed(0)} px`;
}
