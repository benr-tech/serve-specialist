import { describe, expect, it } from 'vitest';
import { detectPhases, findLandingFromHips, findStart, PHASE_ORDER, type PhaseInput } from '../src/analysis/phases';
import { PARAMS } from '../src/analysis/params';
import { smoothingFrames } from '../src/analysis/signals';
import { syntheticServe, type SyntheticOptions } from './fixtures/syntheticServe';

const run = (opts: SyntheticOptions, hand = opts.hand ?? 'right') => {
  const s = syntheticServe(opts);
  const input: PhaseInput = { track: s.track, hand, params: PARAMS.phases, smoothingWindow: smoothingFrames(s.track, PARAMS.smoothingWindowMs) };
  return { result: detectPhases(input), truth: s.truth };
};

/**
 * Allowed error in frames: ±2 at 60 fps (~33 ms); landing gets ±3. Start is the *visible* start
 * (arms clearly moving), which on this fixture's eased keyframes is ~70 ms after the keyframe.
 */
const TOL_60 = { start: 5, trophy: 2, racketDrop: 2, contact: 2, landing: 3 };

describe('detectPhases', () => {
  it('finds all five events on a right-handed serve at 60 fps', () => {
    const { result, truth } = run({});
    for (const name of PHASE_ORDER) {
      expect(result.events[name], name).not.toBeNull();
      expect(Math.abs(result.events[name]! - truth[name]), name).toBeLessThanOrEqual(TOL_60[name]);
    }
    expect(result.warnings).toEqual([]);
  });

  it('works for a left-handed server', () => {
    const { result, truth } = run({ hand: 'left' });
    for (const name of PHASE_ORDER) {
      expect(Math.abs(result.events[name]! - truth[name]), name).toBeLessThanOrEqual(TOL_60[name]);
    }
  });

  it('works at 30 fps', () => {
    const { result, truth } = run({ fps: 30 });
    for (const name of PHASE_ORDER) {
      expect(Math.abs(result.events[name]! - truth[name]), name).toBeLessThanOrEqual(name === 'landing' ? 2 : name === 'start' ? 3 : 1);
    }
  });

  it('events are in serve order', () => {
    const { result } = run({});
    const idx = PHASE_ORDER.map((n) => result.events[n]!);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('reports landing as missing (with a warning) when the player never leaves the ground', () => {
    const { result } = run({ jump: false });
    expect(result.events.contact).not.toBeNull();
    expect(result.events.landing).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/landing/i);
  });

  it('uses a user-chosen contact frame and finds the other events around it', () => {
    const s = syntheticServe({});
    const forced = s.truth.contact - 3;
    const result = detectPhases({
      track: s.track, hand: 'right', params: PARAMS.phases,
      smoothingWindow: smoothingFrames(s.track, PARAMS.smoothingWindowMs), contactFrame: forced,
    });
    expect(result.events.contact).toBe(forced);
    expect(Math.abs(result.events.trophy! - s.truth.trophy)).toBeLessThanOrEqual(2);
    expect(result.events.landing).not.toBeNull();
  });

  it('does not throw when arms are not visible; returns nulls and warnings', () => {
    const { result } = run({ armVisibility: 0.1 });
    expect(result.events.contact).toBeNull();
    expect(result.events.trophy).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('does not mistake a knee tucked up in the air for the trophy crouch', () => {
    const { result, truth } = run({ airTuck: true });
    expect(Math.abs(result.events.trophy! - truth.trophy)).toBeLessThanOrEqual(2);
  });
});

describe('findStart', () => {
  // 30 fps; arm speeds in torso lengths per second.
  const times = Array.from({ length: 90 }, (_, i) => (i * 1000) / 30);
  const p = PARAMS.phases;
  it('skips the pre-serve ball bounces and the ready pause', () => {
    // Bounces 0-1 s (arm moving), ready pause 1-2 s, motion from 2.0 s, release at 2.8 s.
    const toss = times.map((t) => (t < 1000 ? 3 + 2 * Math.sin(t / 50) : t < 2000 ? 0.4 : t < 2700 ? 6 : 1));
    const hit = times.map((t) => (t < 1000 ? 2.5 : t < 2000 ? 0.3 : 3));
    expect(findStart(toss, hit, times, 84, p)).toBe(60);
  });
  it('counts the racket arm moving first as the start', () => {
    const toss = times.map((t) => (t < 2300 ? 0.5 : 6));
    const hit = times.map((t) => (t < 2000 ? 0.3 : 3));
    expect(findStart(toss, hit, times, 84, p)).toBe(60);
  });
});

describe('findLandingFromHips', () => {
  const times = Array.from({ length: 60 }, (_, i) => (i * 1000) / 60);
  it('lands just before the hips fall fastest', () => {
    // Hips fall faster and faster, peak at frame 30 (500 ms), then brake.
    const hip = times.map((_, i) => (i <= 10 ? -2 : i <= 30 ? (i - 10) * 0.3 : Math.max(0, 6 - (i - 30) * 0.8)));
    expect(findLandingFromHips(hip, times, 10, PARAMS.phases)).toBe(27);
  });
  it('finds no landing when the hips never drop (no jump)', () => {
    expect(findLandingFromHips(times.map(() => 0.2), times, 10, PARAMS.phases)).toBeNull();
  });
});
