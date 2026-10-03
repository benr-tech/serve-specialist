import { describe, expect, it } from 'vitest';
import { judgeFootFault, type FootFaultInput } from '../src/analysis/footFault';
import { PARAMS } from '../src/analysis/params';
import { smoothingFrames } from '../src/analysis/signals';
import { syntheticServe, type SyntheticOptions } from './fixtures/syntheticServe';

const run = (opts: SyntheticOptions, override: Partial<FootFaultInput> = {}) => {
  const s = syntheticServe(opts);
  const input: FootFaultInput = {
    track: s.track,
    imageToCourt: s.imageToCourt,
    startFrame: s.truth.start,
    contactFrame: s.truth.contact,
    params: PARAMS.footFault,
    smoothingWindow: smoothingFrames(s.track, PARAMS.smoothingWindowMs),
    ...override,
  };
  return { result: judgeFootFault(input), s };
};

describe('judgeFootFault', () => {
  it('legal: front toe 20 cm behind the line', () => {
    const { result } = run({ frontToeY: -0.2 });
    expect(result.verdict).toBe('legal');
    expect(result.minMarginCm).toBeGreaterThan(17);
    expect(result.minMarginCm).toBeLessThan(23);
    expect(result.foot).toBe('left'); // right-hander's front foot
  });

  it('fault: front toe 12 cm over the line while standing', () => {
    const { result } = run({ frontToeY: 0.12 });
    expect(result.verdict).toBe('fault');
    expect(result.minMarginCm).toBeLessThan(-9);
    expect(result.minMarginCm).toBeGreaterThan(-15);
  });

  it('too close to call: toe right at the line', () => {
    const { result } = run({ frontToeY: 0.0 });
    expect(result.verdict).toBe('too_close');
  });

  it('a toe that crosses the line IN THE AIR before contact is not a fault', () => {
    // frontToeY −0.20 + 0.30 m of forward travel during leg drive → over the line, but airborne.
    const { result } = run({ frontToeY: -0.2 });
    expect(result.verdict).toBe('legal');
  });

  it("left-hander: the right foot is the front foot", () => {
    const { result } = run({ hand: 'left', frontToeY: 0.12 });
    expect(result.verdict).toBe('fault');
    expect(result.foot).toBe('right');
  });

  it("can't tell when a planted foot is implausibly far inside the court (bad court marking)", () => {
    const { result } = run({ frontToeY: 0.8 });
    expect(result.verdict).toBe('cant_tell');
    expect(result.reason).toMatch(/court points/);
  });

  it("can't tell when the feet aren't visible", () => {
    const { result } = run({ footVisibility: 0.2 });
    expect(result.verdict).toBe('cant_tell');
  });

  it("can't tell when contact wasn't detected", () => {
    const { result } = run({}, { contactFrame: null });
    expect(result.verdict).toBe('cant_tell');
  });

  it('uncertainty band is sensible and wider when the camera is farther away', () => {
    const near = run({ cameraY: -4.5 }).result;
    const far = run({ cameraY: -9 }).result;
    expect(near.bandCm).toBeGreaterThan(PARAMS.footFault.keypointAllowanceCm);
    expect(near.bandCm).toBeLessThan(15);
    expect(far.bandCm).toBeGreaterThan(near.bandCm!);
  });

  it('reports one sample per frame in the window [start, contact)', () => {
    const { result, s } = run({});
    expect(result.samples.length).toBe(s.truth.contact - s.truth.start);
    expect(result.samples[0]!.frameIndex).toBe(s.truth.start);
  });

  it('groundedMs counts only stationary, visible foot time', () => {
    const { result, s } = run({});
    const windowMs = s.track.frames[s.truth.contact]!.timeMs - s.track.frames[s.truth.start]!.timeMs;
    expect(result.groundedMs).toBeGreaterThan(PARAMS.footFault.minGroundedMs);
    expect(result.groundedMs).toBeLessThanOrEqual(windowMs);
  });
});
