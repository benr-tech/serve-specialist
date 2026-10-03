/**
 * Offline analysis harness. Loads every samples/tracks/*.json (saved from the dev server),
 * runs the full analysis, and prints phases and every motion check, so changes to the analysis
 * can be checked on real footage in seconds. Dev-only; reads git-ignored files.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { analyzeVideo } from '../src/analysis/analyze';
import type { PoseTrack } from '../src/pose/types';

const only = process.env.CLIP;
const s = (ms: number | undefined) => (ms === undefined ? '  —  ' : (ms / 1000).toFixed(3));

it('report', () => {
  const files = readdirSync('samples/tracks').filter((f) => f.endsWith('.json') && (!only || f.includes(only)));
  const out: string[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(`samples/tracks/${f}`, 'utf8')) as PoseTrack;
    const { clips } = analyzeVideo(raw, { clicks: [], calibrationTimeMs: null, hand: 'right', fileName: f });
    const fps = (raw.frames.length - 1) / ((raw.frames.at(-1)!.timeMs - raw.frames[0]!.timeMs) / 1000);
    out.push(`\n=== ${f}  ${raw.videoWidth}×${raw.videoHeight}  ${raw.frames.length} frames  ${fps.toFixed(1)} fps  ${clips.length} clip(s)`);
    clips.forEach((c, k) => {
      const r = c.report;
      const t = (i: number | null | undefined) => (i === null || i === undefined ? undefined : c.track.frames[i]!.timeMs);
      out.push(`-- clip ${k + 1} [${s(r.clip.startMs)}–${s(r.clip.endMs)}] moving=${r.clip.cameraMoving} drift=${r.clip.driftMedian?.toFixed(1)} hand=${r.hand}(${r.handSource}) swaps=${r.labelRepairs.swappedFrames} merged=${r.labelRepairs.mergedFrames}`);
      out.push(`   footage: player ${r.footage.playerHeightPx?.toFixed(0)}px, ${r.footage.fps.toFixed(0)} fps, arm visible ${r.footage.hittingArmVisible?.toFixed(2)} | tips: ${r.footage.tips.length}`);
      for (const tip of r.footage.tips) out.push(`     • ${tip}`);
      if (r.phases.status === 'ok') {
        const e = r.phases.value.events;
        out.push(`   phases: start ${s(t(e.start))} trophy ${s(t(e.trophy))} drop ${s(t(e.racketDrop))} contact ${s(t(e.contact))} landing ${s(t(e.landing))}  ${r.phases.value.warnings.join('; ')}`);
      } else out.push(`   phases: ${r.phases.status} ${r.phases.message}`);
      if (r.motion.status === 'ok') {
        const m = r.motion.value;
        out.push(`   SCORE ${m.score}  ` + Object.entries(m.categories).map(([k2, v]) => `${k2}=${v.score ?? '–'}`).join(' '));
        for (const ch of m.checks) {
          out.push(`   ${ch.status.padEnd(10)} ${ch.id.padEnd(18)} @${s(t(ch.frameIndex))}  ${ch.measured ?? ''}`);
        }
      }
    });
  }
  writeFileSync('samples/report.txt', out.join('\n') + '\n');
});
