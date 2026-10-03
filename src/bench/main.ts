/**
 * Pose-backend runtime benchmark.
 * Measures, per backend on one clip: pose ms/frame (median and p90), total wall time, and the
 * fraction of frames with a detected person. Speed only, this says nothing about accuracy.
 */
import { MediaPipeBackend, type MediaPipeVariant } from '../pose/mediapipe';
import type { Detection, PoseBackend } from '../pose/types';
import { decodePoseTrack } from '../video/decodeFrames';
import { APP_VERSION } from '../version';

/** Wraps a backend to time each detect() call. */
class Timed implements PoseBackend {
  times: number[] = [];
  constructor(private inner: PoseBackend) {}
  get name() { return this.inner.name; }
  get version() { return this.inner.version; }
  init() { return this.inner.init(); }
  close() { this.inner.close(); }
  detect(src: TexImageSource, w: number, h: number, t: number): Detection | null {
    const t0 = performance.now();
    const r = this.inner.detect(src, w, h, t);
    this.times.push(performance.now() - t0);
    return r;
  }
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function runBenchmark(file: File, log: (s: string) => void) {
  const variants: MediaPipeVariant[] = ['lite', 'full', 'heavy'];
  const results = [];
  for (const v of variants) {
    log(`running ${v}…`);
    const backend = new Timed(new MediaPipeBackend(v));
    await backend.init();
    const t0 = performance.now();
    const track = await decodePoseTrack(file, backend);
    const wallMs = performance.now() - t0;
    backend.close();
    // Skip the first 5 frames: they include one-time GPU shader compilation.
    const steady = backend.times.slice(5);
    results.push({
      backend: backend.name,
      version: backend.version,
      frames: track.frames.length,
      detectedFraction: +(track.frames.filter((f) => f.pose).length / track.frames.length).toFixed(3),
      poseMsPerFrame: { median: +quantile(steady, 0.5).toFixed(1), p90: +quantile(steady, 0.9).toFixed(1) },
      wallMs: Math.round(wallMs),
    });
  }
  return {
    experiment: 'pose-runtime',
    date: new Date().toISOString(),
    appVersion: APP_VERSION,
    clip: { name: file.name, bytes: file.size, sha256: await sha256(file) },
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    results,
  };
}

const out = document.getElementById('out')!;
document.getElementById('file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const report = await runBenchmark(file, (s) => (out.textContent = s));
    out.textContent = JSON.stringify(report, null, 2);
  } catch (err) {
    out.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
});
