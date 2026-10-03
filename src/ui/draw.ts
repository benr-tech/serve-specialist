/** Canvas drawing. Canvases are sized to the video's native resolution, so everything is in video pixels. */
import { COURT_LINES } from '../court/court';
import type { CalibrationClick } from '../court/calibration';
import { applyHomography } from '../geometry/homography';
import type { Mat3 } from '../geometry/types';
import type { KeypointName, Pose } from '../pose/types';

const BONES: [KeypointName, KeypointName][] = [
  ['leftShoulder', 'rightShoulder'], ['leftHip', 'rightHip'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['leftAnkle', 'leftHeel'], ['leftHeel', 'leftToe'], ['leftAnkle', 'leftToe'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'], ['rightAnkle', 'rightHeel'], ['rightHeel', 'rightToe'], ['rightAnkle', 'rightToe'],
  ['leftWrist', 'leftIndex'], ['leftWrist', 'leftPinky'], ['leftIndex', 'leftPinky'],
  ['rightWrist', 'rightIndex'], ['rightWrist', 'rightPinky'], ['rightIndex', 'rightPinky'],
];

/** Line width that looks the same regardless of video resolution. */
const px = (ctx: CanvasRenderingContext2D, n: number) => (n * ctx.canvas.width) / 1280;

export function clear(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, minVisibility = 0.5) {
  ctx.lineWidth = px(ctx, 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  for (const [a, b] of BONES) {
    const p = pose[a], q = pose[b];
    if (!p || !q || p.visibility < minVisibility || q.visibility < minVisibility) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  for (const [name, k] of Object.entries(pose) as [KeypointName, Pose[KeypointName]][]) {
    if (!k || k.visibility < minVisibility) continue;
    const foot = /Toe|Heel/.test(name);
    ctx.fillStyle = foot ? '#d5ee3f' : '#ffffff';
    ctx.beginPath();
    ctx.arc(k.x, k.y, px(ctx, foot ? 5 : /Index|Pinky/.test(name) ? 2.5 : 3.5), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draws the court lines from the calibration so the user can check they sit on the real lines. */
export function drawCourt(ctx: CanvasRenderingContext2D, courtToImage: Mat3) {
  ctx.lineWidth = px(ctx, 2);
  ctx.strokeStyle = 'rgba(213, 238, 63, 0.95)'; // ball yellow: distinct from the painted white lines
  ctx.setLineDash([px(ctx, 10), px(ctx, 6)]);
  for (const [a, b] of COURT_LINES) {
    // Draw as many short segments: straight on the court stays straight in the image,
    // but this keeps lines clean if part of a segment is behind the camera.
    ctx.beginPath();
    for (let s = 0; s <= 20; s++) {
      const p = applyHomography(courtToImage, { x: a.x + ((b.x - a.x) * s) / 20, y: a.y + ((b.y - a.y) * s) / 20 });
      if (s === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

export function drawClicks(ctx: CanvasRenderingContext2D, clicks: CalibrationClick[]) {
  clicks.forEach((c, i) => {
    const r = px(ctx, 11);
    // A ring with a dark outline reads on both bright and dark courts.
    ctx.lineWidth = px(ctx, 4);
    ctx.strokeStyle = 'rgba(26, 29, 25, 0.65)';
    ctx.beginPath();
    ctx.arc(c.image.x, c.image.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = px(ctx, 2);
    ctx.strokeStyle = '#d5ee3f';
    ctx.stroke();
    ctx.fillStyle = '#d5ee3f';
    ctx.beginPath();
    ctx.arc(c.image.x, c.image.y, px(ctx, 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 ${px(ctx, 17)}px system-ui, sans-serif`;
    ctx.lineWidth = px(ctx, 3);
    ctx.strokeStyle = 'rgba(26, 29, 25, 0.8)';
    ctx.strokeText(String(i + 1), c.image.x + r * 1.1, c.image.y - r * 1.1);
    ctx.fillText(String(i + 1), c.image.x + r * 1.1, c.image.y - r * 1.1);
  });
}

/** Marks the front of each foot: green = behind the line, amber = within the band, red = over. */
export function drawFootMarker(ctx: CanvasRenderingContext2D, x: number, y: number, marginCm: number, bandCm: number) {
  ctx.fillStyle = marginCm > bandCm ? '#3fae6a' : marginCm < -bandCm ? '#d5562f' : '#e2a53a';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = px(ctx, 2);
  ctx.beginPath();
  ctx.arc(x, y, px(ctx, 8), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Map a mouse event on a canvas (any CSS size) to video pixels. */
export function eventToVideoPx(e: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
}

/** Highlights a measured joint angle: the two limb segments, an arc at the joint, and a label. */
export function drawAngle(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  label: string,
  color: string,
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = px(ctx, 9);
  ctx.strokeStyle = 'rgba(26, 29, 25, 0.45)';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
  ctx.lineWidth = px(ctx, 5);
  ctx.strokeStyle = color;
  ctx.stroke();

  const r = px(ctx, 34);
  const a1 = Math.atan2(a.y - b.y, a.x - b.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  ctx.lineWidth = px(ctx, 3);
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, a1, a1 + d, d < 0);
  ctx.stroke();

  ctx.font = `700 ${px(ctx, 22)}px system-ui, sans-serif`;
  const mid = a1 + d / 2;
  const lx = b.x - Math.cos(mid) * r * 1.6;
  const ly = b.y - Math.sin(mid) * r * 1.6;
  const w = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(26, 29, 25, 0.85)';
  ctx.beginPath();
  ctx.roundRect(lx - w / 2 - px(ctx, 8), ly - px(ctx, 16), w + px(ctx, 16), px(ctx, 30), px(ctx, 15));
  ctx.fill();
  ctx.fillStyle = '#f7f4ec';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly);
  ctx.restore();
}
