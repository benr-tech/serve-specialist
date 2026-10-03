import { describe, expect, it } from 'vitest';
import { LANDMARKS } from '../src/court/court';
import { detectCourt, medianImage } from '../src/court/detect';
import { applyHomography, invertHomography } from '../src/geometry/homography';
import type { Point } from '../src/geometry/types';
import { renderCourt } from './fixtures/courtImage';
import { makeCamera, mat3Apply } from './fixtures/syntheticServe';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const L = 23.77;

/** Landmarks that are actually inside the frame should be found within `tol` px. */
function expectLandmarks(found: ReturnType<typeof detectCourt>, truth: (p: Point) => Point, tol: number, w = 1280, h = 720) {
  expect(found).not.toBeNull();
  let checked = 0;
  for (const lm of found!.landmarks) {
    const t = truth(LANDMARKS[lm.id].court);
    if (t.x < 5 || t.y < 5 || t.x > w - 5 || t.y > h - 5) continue;
    expect(dist(lm.image, t), lm.id).toBeLessThan(tol);
    checked++;
  }
  expect(checked).toBeGreaterThanOrEqual(3);
}

describe('automatic court detection', () => {
  const cam = makeCamera(-6, { x: -1, z: 2.2, target: [0.3, 8, 0] }); // behind the server, a little to the side
  const feet = mat3Apply(cam.courtToImage, { x: 0.3, y: -0.3 });

  it('finds the court corners on a clean image', () => {
    const r = detectCourt(renderCourt(cam.courtToImage), { feet });
    expectLandmarks(r, (p) => mat3Apply(cam.courtToImage, p), 2);
  });

  it('still finds them with a player over the baseline, a white wall and noise', () => {
    const r = detectCourt(renderCourt(cam.courtToImage, { clutter: true }), { feet });
    expectLandmarks(r, (p) => mat3Apply(cam.courtToImage, p), 3);
  });

  it('measures court positions to within a few centimetres', () => {
    const r = detectCourt(renderCourt(cam.courtToImage, { clutter: true }), { feet })!;
    const imageToCourt = invertHomography(r.courtToImage);
    const toe = { x: 0.3, y: -0.12 };
    const back = applyHomography(imageToCourt, mat3Apply(cam.courtToImage, toe));
    expect(dist(back, toe)).toBeLessThan(0.05);
  });

  it("puts the server's baseline at the end the player stands at, seen from in front", () => {
    // Camera beyond the far baseline, looking back at the server.
    const front = makeCamera(L + 6, { x: 1, z: 2.2, target: [0, 6, 0] });
    const nearServer = mat3Apply(front.courtToImage, { x: 0.3, y: -0.3 });
    const r = detectCourt(renderCourt(front.courtToImage), { feet: nearServer });
    expectLandmarks(r, (p) => mat3Apply(front.courtToImage, p), 3);
  });

  it('without feet, uses the camera view hint to pick the end', () => {
    const r = detectCourt(renderCourt(cam.courtToImage), { view: 'behind' });
    expectLandmarks(r, (p) => mat3Apply(cam.courtToImage, p), 2);
  });

  it('returns null when there is no court', () => {
    const blank = renderCourt(cam.courtToImage);
    for (let i = 0; i < blank.data.length; i += 4) blank.data.set([62, 112, 78, 255], i);
    expect(detectCourt(blank, { feet })).toBeNull();
  });

  it('a median of frames removes a moving player', () => {
    const frames = [0, 1, 2].map((k) => {
      const img = renderCourt(cam.courtToImage);
      const p = mat3Apply(cam.courtToImage, { x: -3 + 3 * k, y: 0 });
      for (let y = Math.round(p.y - 200); y < p.y + 10; y++)
        for (let x = Math.round(p.x - 40); x < p.x + 40; x++) if (x >= 0 && y >= 0 && x < 1280 && y < 720) img.data.set([30, 30, 40, 255], 4 * (y * 1280 + x));
      return img;
    });
    const m = medianImage(frames);
    const clean = renderCourt(cam.courtToImage);
    let diff = 0;
    for (let i = 0; i < m.data.length; i++) diff += Math.abs(m.data[i]! - clean.data[i]!);
    expect(diff / m.data.length).toBeLessThan(0.5);
  });
});
