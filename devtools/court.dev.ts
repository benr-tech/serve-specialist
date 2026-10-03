import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { LANDMARKS, CALIBRATION_ORDER } from '../src/court/court';
import { dilate, houghLines, lineMask } from '../src/court/detect/lines';
import { fitCourt } from '../src/court/detect/fitCourt';
import { applyHomography } from '../src/geometry/homography';
import { renderCourt } from '../tests/fixtures/courtImage';
import { makeCamera, mat3Apply } from '../tests/fixtures/syntheticServe';

it('court debug', () => {
  const out: string[] = [];
  const cam = makeCamera(-6, { x: -1, z: 2.2, target: [0.3, 8, 0] });
  const img = renderCourt(cam.courtToImage);
  const mask = lineMask(img);
  out.push('mask px ' + mask.reduce((a, v) => a + v, 0));
  const lines = houghLines(mask, img.width, img.height);
  for (const l of lines) out.push(`line a=${l.a.toFixed(3)} b=${l.b.toFixed(3)} c=${l.c.toFixed(1)} votes=${l.votes} angle=${(Math.atan2(l.b, l.a) * 180 / Math.PI).toFixed(1)}`);
  const fit = fitCourt(lines, mask, dilate(mask, img.width, img.height, 2), img.width, img.height, { view: 'behind' });
  out.push('fit ' + JSON.stringify(fit && { hit: fit.hitRatio, vis: fit.visibleSamples }));
  for (const id of CALIBRATION_ORDER) {
    const t = mat3Apply(cam.courtToImage, LANDMARKS[id].court);
    const f = fit ? applyHomography(fit.courtToImage, LANDMARKS[id].court) : null;
    out.push(`${id}: truth ${t.x.toFixed(1)},${t.y.toFixed(1)} found ${f?.x.toFixed(1)},${f?.y.toFixed(1)}`);
  }
  writeFileSync('samples/court-debug.txt', out.join('\n'));
});
