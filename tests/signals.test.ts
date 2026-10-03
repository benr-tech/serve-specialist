import { describe, expect, it } from 'vitest';
import { argMax, argMin, frameAtOrAfter, smooth, smoothingFrames, speed, torsoLengthPx } from '../src/analysis/signals';
import { syntheticServe } from './fixtures/syntheticServe';

describe('signals', () => {
  it('smooth keeps straight lines straight and keeps nulls', () => {
    expect(smooth([0, 3, 6, null, 9], 3)).toEqual([0, 3, 6, null, 9]);
  });
  it('smooth keeps a peak at its true height and frame (a moving average would flatten it)', () => {
    const peak = Array.from({ length: 21 }, (_, i) => 100 - (i - 10) ** 2); // max 100 at frame 10
    const s = smooth(peak, 5);
    expect(s[10]).toBeCloseTo(100, 6);
    expect(argMax(s)).toBe(10);
  });
  it('smooth removes a one-frame glitch', () => {
    const flat = [50, 50, 50, 50, 400, 50, 50, 50, 50];
    expect(Math.max(...(smooth(flat, 5) as number[]))).toBeCloseTo(50, 6);
  });
  it('speed uses timestamps (px/s)', () => {
    const s = speed({ x: [0, 10, 20], y: [0, 0, 0] }, [0, 100, 200]);
    expect(s).toEqual([100, 100, 100]);
  });
  it('speed is null when isolated', () => {
    expect(speed({ x: [null, 5, null], y: [null, 5, null] }, [0, 1, 2])).toEqual([null, null, null]);
  });
  it('argMin / argMax skip nulls and respect the range', () => {
    expect(argMin([5, null, 1, 3])).toBe(2);
    expect(argMax([5, null, 1, 9], 0, 3)).toBe(0);
    expect(argMin([null, null])).toBeNull();
  });
  it('frameAtOrAfter', () => {
    expect(frameAtOrAfter([0, 16, 33, 50], 20)).toBe(2);
    expect(frameAtOrAfter([0, 16], 99)).toBe(2);
  });
  it('torso length of the synthetic player is 110 px', () => {
    expect(torsoLengthPx(syntheticServe().track)).toBeCloseTo(110, 0);
  });
});

describe('smoothingFrames', () => {
  it('80 ms is 5 frames at 60 fps and 3 at 30 fps', () => {
    expect(smoothingFrames(syntheticServe({ fps: 60 }).track, 80)).toBe(5);
    expect(smoothingFrames(syntheticServe({ fps: 30 }).track, 80)).toBe(3);
  });
});
