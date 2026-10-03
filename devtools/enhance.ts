/**
 * Dev-only: re-track the sample clips with each footage-enhancement variant and save the tracks
 * as samples/tracks/<clip>__<variant>.json, compared by devtools/variants.dev.ts.
 * In the dev server's page console:
 *   const m = await import('/devtools/enhance.ts'); await m.run(['base', 'mirror']);
 */
import { EnhancedBackend, type EnhanceOptions } from './enhanceBackend';
import { MediaPipeBackend } from '../src/pose/mediapipe';
import { decodePoseTrack } from '../src/video/decodeFrames';

const CLIPS: Record<string, string> = {
  '2026-07-21_filtered-shots': '/samples/2026-07-21_filtered-shots.mp4',
  '2026-10-03_a': '/samples/2026-10-03_a.mov',
  '2026-10-03_b': '/samples/2026-10-03_b.mov',
  '2026-10-03_c': '/samples/2026-10-03_c.mov',
};

export const VARIANTS: Record<string, EnhanceOptions> = {
  base: {},
  levels: { levels: true },
  up: { upscaleToShortSide: 1080 },
  mirror: { mirror: true },
  all: { levels: true, upscaleToShortSide: 1080, mirror: true },
};

export async function run(variants = Object.keys(VARIANTS), clips = Object.keys(CLIPS)): Promise<string[]> {
  const log: string[] = [];
  for (const v of variants) {
    for (const c of clips) {
      const opts = VARIANTS[v]!;
      const backend = new EnhancedBackend(new MediaPipeBackend('heavy'), opts.mirror ? new MediaPipeBackend('heavy') : null, opts);
      await backend.init();
      const file = new File([await (await fetch(CLIPS[c]!)).blob()], c);
      const t0 = performance.now();
      const track = await decodePoseTrack(file, backend);
      backend.close();
      const ms = performance.now() - t0;
      await fetch(`/__dev/save-track?name=${c}__${v}`, { method: 'POST', body: JSON.stringify(track) });
      log.push(`${c}__${v}: ${track.frames.length} frames, ${(ms / track.frames.length).toFixed(1)} ms/frame`);
    }
  }
  return log;
}
