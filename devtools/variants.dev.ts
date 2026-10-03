/**
 * Compares footage-enhancement variants (tracks saved by devtools/enhance.ts as <clip>__<variant>.json):
 * phase error vs the by-eye labels, keypoint jitter, arm-joint visibility, and left/right swaps.
 *   npx vitest run --config devtools/vitest.config.ts devtools/variants.dev.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { analyzeVideo } from '../src/analysis/analyze';
import { PHASE_ORDER } from '../src/analysis/phases';
import type { KeypointName, PoseTrack } from '../src/pose/types';

type Label = { file: string } & Record<(typeof PHASE_ORDER)[number], number>;
const VARIANTS = ['base', 'levels', 'up', 'mirror', 'all'];
const JOINTS: KeypointName[] = ['leftWrist', 'rightWrist', 'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];

/** Median frame-to-frame second difference (torso lengths), over the serve: lower = steadier. */
function jitter(track: PoseTrack, from: number, to: number): number {
  const vals: number[] = [];
  for (let i = from + 1; i < to - 1; i++) {
    const [a, b, c] = [track.frames[i - 1]?.pose, track.frames[i]?.pose, track.frames[i + 1]?.pose];
    if (!a || !b || !c) continue;
    const torso = Math.hypot((b.leftShoulder.x + b.rightShoulder.x - b.leftHip.x - b.rightHip.x) / 2, (b.leftShoulder.y + b.rightShoulder.y - b.leftHip.y - b.rightHip.y) / 2);
    for (const j of JOINTS) {
      if (a[j].visibility < 0.5 || b[j].visibility < 0.5 || c[j].visibility < 0.5) continue;
      vals.push(Math.hypot(a[j].x - 2 * b[j].x + c[j].x, a[j].y - 2 * b[j].y + c[j].y) / torso);
    }
  }
  vals.sort((x, y) => x - y);
  return vals[Math.floor(vals.length / 2)] ?? NaN;
}

it('variants', () => {
  const { serves } = JSON.parse(readFileSync('experiments/2026-10-03_phase-labels_dev-v2.json', 'utf8')) as { serves: Label[] };
  const out: string[] = [];
  for (const v of VARIANTS) {
    const errs: Record<string, number[]> = Object.fromEntries(PHASE_ORDER.map((n) => [n, []]));
    const rows: string[] = [];
    let missing = false;
    for (const lab of serves) {
      const path = `samples/tracks/${lab.file}__${v}.json`;
      if (!existsSync(path)) { missing = true; continue; }
      const raw = JSON.parse(readFileSync(path, 'utf8')) as PoseTrack;
      const { clips } = analyzeVideo(raw, { clicks: [], calibrationTimeMs: null, hand: 'right', fileName: lab.file });
      const clip = clips.find((c) => c.report.clip.startMs <= lab.contact * 1000 && lab.contact * 1000 <= c.report.clip.endMs);
      if (!clip) { rows.push(`${lab.file} @${lab.contact}: no clip`); continue; }
      const ph = clip.report.phases.status === 'ok' ? clip.report.phases.value.events : null;
      const parts: string[] = [];
      for (const n of PHASE_ORDER) {
        const i = ph?.[n];
        if (i === null || i === undefined) { errs[n]!.push(NaN); parts.push(`${n} miss`); continue; }
        const d = clip.track.frames[i]!.timeMs / 1000 - lab[n];
        errs[n]!.push(d);
        parts.push(`${n} ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
      }
      const t = clip.track.frames;
      const from = t.findIndex((f) => f.timeMs >= (lab.start - 0.3) * 1000), to = t.findIndex((f) => f.timeMs >= (lab.landing + 0.3) * 1000);
      const win = t.slice(from, to < 0 ? undefined : to);
      const vis = (j: KeypointName) => win.filter((f) => f.pose && f.pose[j].visibility >= 0.5).length / Math.max(1, win.length);
      const hand = clip.report.hand;
      const m = clip.report.motion.status === 'ok' ? clip.report.motion.value : null;
      rows.push(`  ${lab.file.slice(-12)} @${lab.contact.toFixed(2)} ${parts.join(' ')} | jitter ${jitter(clip.track, from, to < 0 ? t.length : to).toFixed(4)} hitWrist ${vis(`${hand}Wrist`).toFixed(2)} hitElbow ${vis(`${hand}Elbow`).toFixed(2)} swaps ${clip.report.labelRepairs.swappedFrames} score ${m?.score ?? '–'}${m?.confidence === 'rough' ? ' (rough)' : ''}`);
    }
    if (missing && rows.length === 0) continue;
    const mae = PHASE_ORDER.map((n) => {
      const ok = errs[n]!.filter((x) => !Number.isNaN(x));
      return `${n} ${(ok.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, ok.length)).toFixed(3)}${ok.length < errs[n]!.length ? ` (${errs[n]!.length - ok.length} miss)` : ''}`;
    });
    out.push(`== ${v}: MAE ${mae.join('  ')}`, ...rows);
  }
  writeFileSync('samples/variants.txt', out.join('\n') + '\n');
});
