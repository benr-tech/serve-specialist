/**
 * Phase-timing check against by-eye labels (experiments/2026-10-03_phase-labels_dev-v2.json).
 * Prints detected - labeled time per event and the mean absolute error. Dev-only; reads the
 * git-ignored tracks in samples/tracks.
 *   npx vitest run --config devtools/vitest.config.ts devtools/phases.dev.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { analyzeVideo } from '../src/analysis/analyze';
import { PHASE_ORDER } from '../src/analysis/phases';
import type { PoseTrack } from '../src/pose/types';

type Label = { file: string } & Record<(typeof PHASE_ORDER)[number], number>;

it('phase timing vs labels', () => {
  const { serves } = JSON.parse(readFileSync('experiments/2026-10-03_phase-labels_dev-v2.json', 'utf8')) as { serves: Label[] };
  const errs: Record<string, number[]> = Object.fromEntries(PHASE_ORDER.map((n) => [n, []]));
  const out: string[] = [];
  const cache = new Map<string, ReturnType<typeof analyzeVideo>>();
  for (const lab of serves) {
    if (!cache.has(lab.file)) {
      const raw = JSON.parse(readFileSync(`samples/tracks/${lab.file}.json`, 'utf8')) as PoseTrack;
      cache.set(lab.file, analyzeVideo(raw, { clicks: [], calibrationTimeMs: null, hand: 'right', fileName: lab.file }));
    }
    const clip = cache.get(lab.file)!.clips.find((c) => c.report.clip.startMs <= lab.contact * 1000 && lab.contact * 1000 <= c.report.clip.endMs);
    const row = [`${lab.file.padEnd(26)} @${lab.contact.toFixed(2)}`];
    for (const n of PHASE_ORDER) {
      const ph = clip?.report.phases;
      const i = ph?.status === 'ok' ? ph.value.events[n] : null;
      if (i === null || i === undefined || !clip) { row.push(`${n} miss`); errs[n]!.push(NaN); continue; }
      const d = clip.track.frames[i]!.timeMs / 1000 - lab[n];
      errs[n]!.push(d);
      row.push(`${n} ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
    }
    out.push(row.join('  '));
  }
  out.push('MAE (s): ' + PHASE_ORDER.map((n) => {
    const v = errs[n]!.filter((x) => !Number.isNaN(x));
    return `${n} ${(v.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, v.length)).toFixed(3)} (${errs[n]!.length - v.length} missed)`;
  }).join('  '));
  writeFileSync('samples/phases.txt', out.join('\n') + '\n');
  console.log(out.join('\n'));
});
