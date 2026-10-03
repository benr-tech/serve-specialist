import { describe, expect, it } from 'vitest';
import { applyHomography, invertHomography, pixelErrorToCourtCm, solveHomography } from '../src/geometry/homography';
import type { Mat3, Point } from '../src/geometry/types';
import { LANDMARKS, CALIBRATION_ORDER } from '../src/court/court';
import { makeCamera, mat3Apply } from './fixtures/syntheticServe';

const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cam = makeCamera();
const corners = CALIBRATION_ORDER.slice(0, 4).map((id) => LANDMARKS[id].court);

describe('applyHomography', () => {
  it('identity leaves points alone', () => {
    expect(applyHomography(I, { x: 3, y: -2 })).toEqual({ x: 3, y: -2 });
  });
  it('divides by the third coordinate', () => {
    const H: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 2];
    const p = applyHomography(H, { x: 5, y: 7 });
    expect(p.x).toBeCloseTo(5, 12);
    expect(p.y).toBeCloseTo(7, 12);
  });
  it('matches a known perspective transform', () => {
    const p = { x: 1.2, y: -0.3 };
    expect(dist(applyHomography(cam.courtToImage, p), mat3Apply(cam.courtToImage, p))).toBeLessThan(1e-9);
  });
});

describe('solveHomography', () => {
  it('recovers the camera from 4 court corners (court → image)', () => {
    const img = corners.map((c) => mat3Apply(cam.courtToImage, c));
    const H = solveHomography(corners, img);
    // Check on points that were NOT used to fit.
    for (const p of [{ x: 0, y: 0 }, { x: -1.5, y: -0.4 }, { x: 3, y: 9 }]) {
      expect(dist(applyHomography(H, p), mat3Apply(cam.courtToImage, p))).toBeLessThan(1e-6);
    }
  });

  it('maps image pixels back to court metres (image → court)', () => {
    const img = corners.map((c) => mat3Apply(cam.courtToImage, c));
    const H = solveHomography(img, corners);
    const foot = { x: 0.3, y: -0.12 };
    expect(dist(applyHomography(H, mat3Apply(cam.courtToImage, foot)), foot)).toBeLessThan(1e-6);
  });

  it('least-squares fit with 6 noisy clicks stays within 3 cm near the baseline', () => {
    const ids = CALIBRATION_ORDER; // all 6
    const court = ids.map((id) => LANDMARKS[id].court);
    const noise = [[0.5, -0.4], [-0.3, 0.5], [0.4, 0.3], [-0.5, -0.2], [0.2, -0.5], [-0.4, 0.4]];
    const img = court.map((c, i) => {
      const p = mat3Apply(cam.courtToImage, c);
      return { x: p.x + noise[i]![0]!, y: p.y + noise[i]![1]! };
    });
    const H = solveHomography(img, court);
    for (const truth of [{ x: 0.3, y: -0.1 }, { x: -2, y: 0 }, { x: 2, y: 0.5 }]) {
      expect(dist(applyHomography(H, mat3Apply(cam.courtToImage, truth)), truth)).toBeLessThan(0.03);
    }
  });

  it('rejects fewer than 4 points', () => {
    expect(() => solveHomography(corners.slice(0, 3), corners.slice(0, 3))).toThrow();
  });
  it('rejects mismatched lengths', () => {
    expect(() => solveHomography(corners, corners.slice(0, 3))).toThrow();
  });
  it('rejects 3 collinear points out of 4', () => {
    const bad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
    expect(() => solveHomography(bad, corners)).toThrow();
  });
});

describe('invertHomography', () => {
  it('round-trips a point', () => {
    const H = cam.courtToImage;
    const p = { x: -0.7, y: 2.2 };
    expect(dist(applyHomography(invertHomography(H), applyHomography(H, p)), p)).toBeLessThan(1e-9);
  });
  it('throws on a singular matrix', () => {
    expect(() => invertHomography([1, 2, 3, 2, 4, 6, 0, 0, 1])).toThrow();
  });
});

describe('pixelErrorToCourtCm', () => {
  it('is exact for a pure scale (1 px = 1 cm)', () => {
    const H: Mat3 = [0.01, 0, 0, 0, 0.01, 0, 0, 0, 1];
    expect(pixelErrorToCourtCm(H, { x: 100, y: 100 }, 3)).toBeCloseTo(3, 6);
  });
  it('grows with distance from the camera', () => {
    const near = mat3Apply(cam.courtToImage, { x: 0, y: 0 });
    const far = mat3Apply(cam.courtToImage, { x: 0, y: 5.46 });
    const nearCm = pixelErrorToCourtCm(cam.imageToCourt, near, 3);
    const farCm = pixelErrorToCourtCm(cam.imageToCourt, far, 3);
    expect(nearCm).toBeGreaterThan(0);
    expect(farCm).toBeGreaterThan(nearCm);
  });
});
