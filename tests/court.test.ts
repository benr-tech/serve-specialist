import { describe, expect, it } from 'vitest';
import { CALIBRATION_ORDER, LANDMARKS, REQUIRED_POINTS } from '../src/court/court';
import { calibrate } from '../src/court/calibration';

describe('court model', () => {
  it('singles back box is 8.18 m × 5.435 m between line centers', () => {
    const [a, b, c] = CALIBRATION_ORDER.slice(0, 3).map((id) => LANDMARKS[id].court);
    expect(b!.x - a!.x).toBeCloseTo(8.18, 6);
    expect(c!.y - b!.y).toBeCloseTo(5.435, 6);
  });
  it('required points are not collinear', () => {
    const [p, q, r] = CALIBRATION_ORDER.slice(0, REQUIRED_POINTS).map((id) => LANDMARKS[id].court);
    const area = (q!.x - p!.x) * (r!.y - p!.y) - (q!.y - p!.y) * (r!.x - p!.x);
    expect(Math.abs(area)).toBeGreaterThan(1);
  });
});

describe('calibrate', () => {
  const box = [
    { id: 'baseline_singles_left' as const, image: { x: 100, y: 600 } },
    { id: 'baseline_singles_right' as const, image: { x: 1100, y: 600 } },
    { id: 'service_singles_right' as const, image: { x: 850, y: 350 } },
    { id: 'service_singles_left' as const, image: { x: 350, y: 350 } },
  ];
  it('accepts four points that form a box', () => {
    expect(() => calibrate(box)).not.toThrow();
  });
  it('rejects points clicked in a crossed order', () => {
    const crossed = [box[0]!, box[1]!, { ...box[2]!, image: box[3]!.image }, { ...box[3]!, image: box[2]!.image }];
    expect(() => calibrate(crossed)).toThrow(/box/);
  });
  it('reports a residual only when there are more than 4 points', () => {
    expect(calibrate(box).residualCm).toBeNull();
  });
});
