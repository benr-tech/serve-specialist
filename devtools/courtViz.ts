/**
 * Dev-only court-detection viewer. In the dev server's page console:
 *   const m = await import('/devtools/courtViz.ts'); await m.show([['/samples/x.mov', 1.0]]);
 * Draws, per frame: line pixels (white), Hough lines (colours), fitted court (yellow).
 */
import { fitCourt, MODEL_LINES } from '../src/court/detect/fitCourt';
import { dilate, houghLines, lineMask } from '../src/court/detect/lines';
import { applyHomography } from '../src/geometry/homography';

function el<T extends HTMLElement>(id: string, make: () => T): T {
  return (document.getElementById(id) as T | null) ?? document.body.appendChild(Object.assign(make(), { id }));
}

async function frameAt(src: string, t: number, maxDim: number) {
  const v = el('cdv', () => Object.assign(document.createElement('video'), { muted: true }));
  v.style.cssText = 'position:fixed;left:0;top:0;width:100px;z-index:1';
  v.src = src;
  await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
  await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));
  const s = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * s);
  c.height = Math.round(v.videoHeight * s);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(v, 0, 0, c.width, c.height);
  return { canvas: c, img: x.getImageData(0, 0, c.width, c.height) };
}

export async function show(clips: [string, number][], maxDim = 960): Promise<string> {
  const out = el('cdbg', () => document.createElement('canvas'));
  out.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;z-index:10000;background:#000';
  const panels: HTMLCanvasElement[] = [], info: string[] = [];
  for (const [src, t] of clips) {
    const { canvas, img } = await frameAt(src, t, maxDim);
    const w = img.width, h = img.height;
    const t0 = performance.now();
    const mask = lineMask({ width: w, height: h, data: img.data });
    const lines = houghLines(mask, w, h);
    const fit = fitCourt(lines, mask, dilate(mask, w, h, 2), w, h, { view: 'behind' });
    info.push(`${src.split('/').pop()}@${t}: ${w}x${h} mask ${mask.reduce((a, b) => a + b, 0)} lines ${lines.length} fit ${fit ? `${fit.hitRatio.toFixed(2)}/${fit.visibleSamples}` : 'none'} ${(performance.now() - t0).toFixed(0)}ms`);
    const x = canvas.getContext('2d')!;
    const id = x.getImageData(0, 0, w, h);
    for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) id.data[4 * i + k] = mask[i] ? 255 : id.data[4 * i + k]! * 0.35;
    x.putImageData(id, 0, 0);
    const cols = ['#f44', '#4f4', '#48f', '#f4f', '#4ff', '#fa0'];
    lines.forEach((l, k) => {
      x.strokeStyle = cols[k % cols.length]!;
      x.lineWidth = 1;
      x.beginPath();
      if (Math.abs(l.b) > Math.abs(l.a)) { x.moveTo(0, -l.c / l.b); x.lineTo(w, -(l.a * w + l.c) / l.b); }
      else { x.moveTo(-l.c / l.a, 0); x.lineTo(-(l.b * h + l.c) / l.a, h); }
      x.stroke();
    });
    if (fit) {
      x.strokeStyle = '#ff0';
      x.lineWidth = 2;
      for (const mline of MODEL_LINES) {
        const a = mline.kind === 'across' ? { x: mline.from, y: mline.at } : { x: mline.at, y: mline.from };
        const b = mline.kind === 'across' ? { x: mline.to, y: mline.at } : { x: mline.at, y: mline.to };
        x.beginPath();
        for (let k = 0; k <= 20; k++) {
          const p = applyHomography(fit.courtToImage, { x: a.x + ((b.x - a.x) * k) / 20, y: a.y + ((b.y - a.y) * k) / 20 });
          if (k) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y);
        }
        x.stroke();
      }
    }
    panels.push(canvas);
  }
  const H = 700;
  out.width = Math.round(panels.reduce((a, c) => a + (c.width * H) / c.height, 0));
  out.height = H;
  const ox = out.getContext('2d')!;
  let xo = 0;
  for (const c of panels) { const ww = (c.width * H) / c.height; ox.drawImage(c, xo, 0, ww, H); xo += ww; }
  return info.join('\n');
}
