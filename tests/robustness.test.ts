import { describe, expect, it } from 'vitest';
import { analyzeVideo } from '../src/analysis/analyze';
import { PARAMS } from '../src/analysis/params';
import { detectPhases } from '../src/analysis/phases';
import { detectHittingSide, findCuts, findSegments } from '../src/analysis/segments';
import { smoothingFrames } from '../src/analysis/signals';
import { fixLeftRightSwaps } from '../src/pose/consistency';
import type { KeypointName, Pose, PoseTrack } from '../src/pose/types';
import { renderCourt } from './fixtures/courtImage';
import { syntheticServe } from './fixtures/syntheticServe';

const UPPER: [KeypointName, KeypointName][] = [
  ['leftShoulder', 'rightShoulder'], ['leftElbow', 'rightElbow'], ['leftWrist', 'rightWrist'], ['leftIndex', 'rightIndex'], ['leftPinky', 'rightPinky'],
];

/** Trade the upper-body left/right labels on frames [from, to], like the pose model does from behind. */
function flipUpper(track: PoseTrack, from: number, to: number) {
  for (let i = from; i <= to; i++) {
    const f = track.frames[i]!;
    for (const obj of [f.pose, f.world] as (Record<string, unknown> | null)[]) {
      if (!obj) continue;
      for (const [l, r] of UPPER) [obj[l], obj[r]] = [obj[r], obj[l]];
    }
  }
}

const window = (t: PoseTrack) => smoothingFrames(t, PARAMS.smoothingWindowMs);

describe('left/right repair', () => {
  it('undoes an upper-body label swap and leaves the legs alone', () => {
    const s = syntheticServe();
    const original = s.track.frames.map((f) => ({ ...f.pose! }) as Pose);
    flipUpper(s.track, 40, 80);
    const { track, swappedFrames } = fixLeftRightSwaps(s.track);
    expect(swappedFrames).toContain(40);
    for (const i of [40, 60, 80]) {
      expect(track.frames[i]!.pose!.rightWrist.x).toBeCloseTo(original[i]!.rightWrist.x, 6);
      expect(track.frames[i]!.pose!.leftKnee.x).toBeCloseTo(original[i]!.leftKnee.x, 6);
    }
  });

  it('phase detection survives a swap that would otherwise move "contact" to the toss', () => {
    const s = syntheticServe();
    flipUpper(s.track, s.truth.start, s.truth.trophy + 5);
    const repaired = fixLeftRightSwaps(s.track).track;
    const r = detectPhases({ track: repaired, hand: 'right', params: PARAMS.phases, smoothingWindow: window(repaired) });
    expect(Math.abs(r.events.contact! - s.truth.contact)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.events.trophy! - s.truth.trophy)).toBeLessThanOrEqual(2);
  });

  it('does nothing to a clean track', () => {
    expect(fixLeftRightSwaps(syntheticServe().track).swappedFrames).toEqual([]);
  });
});

describe('trophy = deepest knee bend after ball release', () => {
  it('moves the trophy to the knee-bend peak when the knees load after the release', () => {
    const s = syntheticServe();
    const bendAt = s.truth.trophy + 12; // 200 ms after release at 60 fps
    for (let i = 0; i < s.track.frames.length; i++) {
      const w = s.track.frames[i]!.world!;
      const z = 0.3 * Math.max(0, 1 - Math.abs(i - bendAt) / 10); // bend builds and releases around bendAt
      for (const side of ['left', 'right'] as const) {
        const x = side === 'left' ? -0.1 : 0.1;
        w[`${side}Hip`] = { x, y: 0, z: 0, visibility: 0.95 };
        w[`${side}Knee`] = { x, y: 0.42, z: -z, visibility: 0.95 };
        w[`${side}Ankle`] = { x, y: 0.84, z: 0, visibility: 0.95 };
      }
    }
    const r = detectPhases({ track: s.track, hand: 'right', params: PARAMS.phases, smoothingWindow: window(s.track) });
    expect(Math.abs(r.events.trophy! - bendAt)).toBeLessThanOrEqual(1);
    expect(r.events.start).toBeLessThan(s.truth.trophy); // toss start still anchored on the release
  });
});

describe('hitting arm detection', () => {
  it('finds the racket arm from its speed, for either hand', () => {
    for (const hand of ['right', 'left'] as const) {
      const t = syntheticServe({ hand }).track;
      expect(detectHittingSide(t, window(t), PARAMS.segments.hittingArmSpeedRatio)?.side).toBe(hand);
    }
  });
});

describe('phase detection with a moving camera', () => {
  it('still finds contact when the view slowly zooms in (SwingVision-style)', () => {
    const s = syntheticServe();
    const n = s.track.frames.length;
    for (const f of s.track.frames) {
      const zoom = 1 + (0.6 * f.index) / n; // 60 % zoom-in over the clip, centered on (640, 360)
      for (const k of Object.values(f.pose!)) {
        k.x = 640 + (k.x - 640) * zoom;
        k.y = 360 + (k.y - 360) * zoom;
      }
    }
    const r = detectPhases({ track: s.track, hand: 'right', params: PARAMS.phases, smoothingWindow: window(s.track) });
    expect(Math.abs(r.events.contact! - s.truth.contact)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.events.trophy! - s.truth.trophy)).toBeLessThanOrEqual(2);
  });
});

describe('clips', () => {
  /** Two synthetic serves back to back with a hard cut, plus scene-change numbers like the decoder records. */
  function compilation(drift: number) {
    const a = syntheticServe().track, b = syntheticServe().track;
    const dt = a.frames[1]!.timeMs;
    const frames = [...a.frames, ...b.frames.map((f) => ({ ...f, timeMs: f.timeMs + a.frames.length * dt }))].map((f, i) => ({
      ...f, index: i, scene: { full: i === a.frames.length ? 35 : 3 + (i % 3) * 0.5, background: 2, drift },
    }));
    return { track: { ...a, frames }, cutAt: a.frames.length };
  }

  it('finds the hard cut between two serves', () => {
    const { track, cutAt } = compilation(3);
    expect(findCuts(track, PARAMS.segments)).toEqual([cutAt]);
    const segs = findSegments(track, PARAMS.segments);
    expect(segs.map((s) => [s.start, s.end])).toEqual([[0, cutAt], [cutAt, track.frames.length]]);
    expect(segs.every((s) => !s.cameraMoving)).toBe(true);
  });

  it('flags a moving camera from background drift', () => {
    const { track } = compilation(15);
    expect(findSegments(track, PARAMS.segments).every((s) => s.cameraMoving)).toBe(true);
  });

  it('analyzes each serve on its own, and only uses the court marking on the clip it was made on', () => {
    const { track, cutAt } = compilation(3);
    const s = syntheticServe();
    const corners = [
      { id: 'baseline_singles_left' as const, court: { x: -4.09, y: 0.025 } },
      { id: 'baseline_singles_right' as const, court: { x: 4.09, y: 0.025 } },
      { id: 'service_singles_right' as const, court: { x: 4.09, y: 5.46 } },
      { id: 'service_singles_left' as const, court: { x: -4.09, y: 5.46 } },
    ];
    const H = s.courtToImage;
    const toImage = (p: { x: number; y: number }) => {
      const w = H[6] * p.x + H[7] * p.y + H[8];
      return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
    };
    const clicks = corners.map((c) => ({ id: c.id, image: toImage(c.court) }));
    const { clips } = analyzeVideo(track, { clicks, calibrationTimeMs: 100, hand: 'right', fileName: 't.mp4' });
    expect(clips).toHaveLength(2);
    for (const c of clips) {
      expect(c.report.phases.status).toBe('ok');
      if (c.report.phases.status === 'ok') {
        const contact = c.report.phases.value.events.contact!;
        expect(Math.abs(contact - s.truth.contact)).toBeLessThanOrEqual(2);
      }
    }
    expect(clips[0]!.report.calibration.status).toBe('ok');
    expect(clips[0]!.report.footFault.status).toBe('ok');
    expect(clips[1]!.report.calibration.status).toBe('skipped');
    expect(clips[1]!.track.frames[0]!.timeMs).toBeCloseTo(track.frames[cutAt]!.timeMs, 6);
  });
});

describe('automatic court calibration in the full pipeline', () => {
  it('finds the court in the stills and makes a foot-fault call without any clicks', () => {
    for (const [toeY, verdict] of [[-0.2, 'legal'], [0.12, 'fault']] as const) {
      const s = syntheticServe({ frontToeY: toeY });
      const still = { timeMs: 0, image: renderCourt(s.courtToImage), scale: 1 };
      const { clips } = analyzeVideo(s.track, { clicks: [], calibrationTimeMs: null, hand: 'right', fileName: 't.mp4', stills: [still] });
      const r = clips[0]!.report;
      expect(r.calibration.status).toBe('ok');
      if (r.calibration.status === 'ok') expect(r.calibration.value.source).toBe('auto');
      expect(r.footFault.status).toBe('ok');
      if (r.footFault.status === 'ok') expect(r.footFault.value.verdict).toBe(verdict);
    }
  });

  it('a court marked by hand overrides the automatic one', () => {
    const s = syntheticServe();
    const still = { timeMs: 0, image: renderCourt(s.courtToImage), scale: 1 };
    const H = s.courtToImage;
    const toImage = (p: { x: number; y: number }) => {
      const w = H[6] * p.x + H[7] * p.y + H[8];
      return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
    };
    const clicks = ([
      ['baseline_singles_left', -4.09, 0.025], ['baseline_singles_right', 4.09, 0.025],
      ['service_singles_right', 4.09, 5.46], ['service_singles_left', -4.09, 5.46],
    ] as const).map(([id, x, y]) => ({ id, image: toImage({ x, y }) }));
    const { clips } = analyzeVideo(s.track, { clicks, calibrationTimeMs: 0, hand: 'right', fileName: 't.mp4', stills: [still] });
    const cal = clips[0]!.report.calibration;
    expect(cal.status === 'ok' && cal.value.source).toBe('manual');
  });
});
