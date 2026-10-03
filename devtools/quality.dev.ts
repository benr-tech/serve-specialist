/** Dev-only: per-clip footage quality numbers (player size, keypoint visibility, tracker jumps). */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { PoseTrack } from '../src/pose/types';

it('quality', () => {
  const out: string[] = [];
  for (const f of readdirSync('samples/tracks').filter((x) => x.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(`samples/tracks/${f}`, 'utf8')) as PoseTrack;
    const torsos: number[] = [], heights: number[] = [];
    const vis: Record<string, number[]> = {};
    let jumps = 0;
    let prev: { x: number; y: number } | null = null;
    for (const fr of t.frames) {
      const p = fr.pose;
      if (!p) { prev = null; continue; }
      const sx = (p.leftShoulder.x + p.rightShoulder.x) / 2, sy = (p.leftShoulder.y + p.rightShoulder.y) / 2;
      const hx = (p.leftHip.x + p.rightHip.x) / 2, hy = (p.leftHip.y + p.rightHip.y) / 2;
      const torso = Math.hypot(sx - hx, sy - hy);
      torsos.push(torso);
      heights.push(Math.max(p.leftAnkle.y, p.rightAnkle.y) - p.nose.y);
      for (const k of ['leftWrist', 'rightWrist', 'leftElbow', 'rightElbow', 'leftAnkle', 'leftToe'] as const) (vis[k] ??= []).push(p[k].visibility);
      if (prev && Math.hypot(hx - prev.x, hy - prev.y) > 1.5 * torso) jumps++;
      prev = { x: hx, y: hy };
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
    const frac = (a: number[]) => (a.filter((v) => v >= 0.5).length / a.length).toFixed(2);
    out.push(`${f}: ${t.videoWidth}x${t.videoHeight} torso ${med(torsos).toFixed(0)}px body ${med(heights).toFixed(0)}px | visible≥0.5: ` +
      Object.entries(vis).map(([k, v]) => `${k} ${frac(v)}`).join(' ') + ` | hip jumps >1.5 torso: ${jumps}`);
  }
  writeFileSync('samples/quality.txt', out.join('\n') + '\n');
});
