/**
 * A fake serve with known answers, so the core modules can be tested without real video.
 *
 * - A simulated pinhole camera stands behind the baseline (rear-oblique, like DATA.md).
 * - Feet are real 3D points projected through that camera, so a foot lifted off the ground
 *   lands in the "wrong" place when mapped through the ground homography, exactly the
 *   trap the foot-fault rule must avoid.
 * - Arms follow keyframed image-space trajectories with known event times.
 * - Every coordinate gets ±0.8 px deterministic jitter, like a real pose model.
 *
 * Has its own tiny matrix helpers so tests don't depend on the code under test.
 */
import type { Mat3, Point } from '../../src/geometry/types';
import type { PhaseName } from '../../src/analysis/phases';
import type { Keypoint, KeypointName, Pose, PoseFrame, PoseTrack, Side, WorldPose } from '../../src/pose/types';

type Vec3 = [number, number, number];

export const EVENT_TIMES_S: Record<PhaseName, number> = {
  start: 0.3,
  trophy: 1.1,
  racketDrop: 1.5,
  contact: 1.75,
  landing: 2.05,
};
const PUSH_OFF_S = 1.55;
const APEX_S = 1.85;

export interface SyntheticOptions {
  fps?: number;
  hand?: Side;
  /** Court y (m) of the front toe while standing. Negative = behind the baseline. */
  frontToeY?: number;
  /** Visibility given to heel/toe/ankle keypoints. */
  footVisibility?: number;
  /** Visibility given to wrists/elbows. */
  armVisibility?: number;
  /** Camera y position (m); more negative = farther behind the baseline. */
  cameraY?: number;
  /** If false the feet never leave the ground (no jump, so no landing). */
  jump?: boolean;
  /** Delay (s) of the back foot's whole jump relative to the front foot, so it lands later. Negative = lands first. */
  backFootDelayS?: number;
  /** Kick the back foot up in the air after push-off (bends that knee far more than the trophy crouch). */
  airTuck?: boolean;
}

export interface SyntheticServe {
  track: PoseTrack;
  imageToCourt: Mat3;
  courtToImage: Mat3;
  /** Frame index of each event. */
  truth: Record<PhaseName, number>;
  /** Project a 3D court point (x, y, z metres) to image px. */
  project: (p: Vec3) => Point;
}

// ---------- small independent math helpers ----------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function mat3Apply(H: Mat3, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function mat3Inverse(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

// ---------- camera ----------
export function makeCamera(cameraY = -4.5, opts: { x?: number; z?: number; target?: Vec3 } = {}) {
  const C: Vec3 = [opts.x ?? -2.5, cameraY, opts.z ?? 1.3];
  const target: Vec3 = opts.target ?? [0.5, 4, 0];
  const f = 1000, cx = 640, cy = 360;
  const fwd = norm(sub(target, C));
  const right = norm(cross(fwd, [0, 0, 1]));
  const down = cross(fwd, right);
  const project = (X: Vec3): Point => {
    const d = sub(X, C);
    const z = dot(fwd, d);
    return { x: (f * dot(right, d)) / z + cx, y: (f * dot(down, d)) / z + cy };
  };
  // Ground plane (z = 0): image ~ K * [r1 r2 -R*C] * [x y 1]
  const rows = [right, down, fwd];
  const t = rows.map((r) => -dot(r, C));
  const M = rows.map((r, k) => [r[0], r[1], t[k]!]);
  const K = [[f, 0, cx], [0, f, cy], [0, 0, 1]];
  const H: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) H.push(K[r]![0]! * M[0]![c]! + K[r]![1]! * M[1]![c]! + K[r]![2]! * M[2]![c]!);
  const courtToImage = H as Mat3;
  return { project, courtToImage, imageToCourt: mat3Inverse(courtToImage) };
}

// ---------- trajectories ----------
/** Smoothstep interpolation through [time, value] keyframes. Extremes occur only at keyframes. */
function keyframes(keys: [number, number][], t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let k = 0; k < keys.length - 1; k++) {
    const [t0, v0] = keys[k]!;
    const [t1, v1] = keys[k + 1]!;
    if (t <= t1) {
      const s = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * s * s * (3 - 2 * s);
    }
  }
  return keys[keys.length - 1]![1];
}

const TOSS_WRIST_Y: [number, number][] = [[0, 470], [0.3, 485], [1.1, 120], [1.75, 300], [2.5, 420]];
/** As on real footage, the hitting hand peaks 40 ms before contact (1.75 s). */
const HIT_PEAK_S = EVENT_TIMES_S.contact - 0.04;
const HIT_WRIST_Y: [number, number][] = [[0, 440], [0.3, 445], [1.1, 270], [1.5, 350], [HIT_PEAK_S, 50], [2.1, 480], [2.5, 500]];
const HIT_ELBOW_Y: [number, number][] = [[0, 400], [0.3, 400], [1.1, 320], [1.5, 240], [HIT_PEAK_S, 170], [2.1, 420], [2.5, 430]];
const TOSS_ELBOW_Y: [number, number][] = [[0, 400], [0.3, 410], [1.1, 230], [1.75, 330], [2.5, 400]];

/** Foot height (m) and forward travel (m) at time t. Feet hit the ground fast, then stop. */
function footMotion(t: number, jump: boolean): { z: number; dy: number } {
  if (!jump || t <= PUSH_OFF_S) return { z: 0, dy: 0 };
  const zMax = 0.4;
  const dyAtLanding = 0.6;
  if (t >= EVENT_TIMES_S.landing) return { z: 0, dy: dyAtLanding };
  const dy = (dyAtLanding * (t - PUSH_OFF_S)) / (EVENT_TIMES_S.landing - PUSH_OFF_S);
  if (t <= APEX_S) {
    // Ballistic: fastest at take-off, slowing to the apex.
    const s = (t - PUSH_OFF_S) / (APEX_S - PUSH_OFF_S);
    return { z: zMax * (1 - (1 - s) * (1 - s)), dy };
  }
  const s = (t - APEX_S) / (EVENT_TIMES_S.landing - APEX_S);
  return { z: zMax * (1 - s * s), dy }; // accelerating down, abrupt stop at landing
}

/**
 * How far the hips sink (m) after the feet touch down: the legs absorb the landing, so the hips
 * keep falling for a moment (a little faster at first, as on real footage) and then brake to a stop.
 */
function landingSink(t: number, jump: boolean): number {
  const tau = t - EVENT_TIMES_S.landing;
  if (!jump || tau <= 0) return 0;
  const v0 = (2 * 0.4) / (EVENT_TIMES_S.landing - APEX_S); // touchdown speed (zMax = 0.4 m)
  const rise = 0.05, brake = 0.06;
  if (tau <= rise) return v0 * tau + 2 * tau * tau;
  const u = Math.min(tau - rise, brake);
  const v1 = v0 + 4 * rise;
  return v0 * rise + 2 * rise * rise + v1 * u - (v1 * u * u) / (2 * brake);
}

/**
 * Stand-in 3D pose: the image pose scaled to metres (250 px = 1 m), centered between the hips,
 * with z = 0. Enough to exercise code that reads world landmarks; angles equal the 2D ones.
 */
export function flatWorld(pose: Pose): WorldPose {
  const cx = (pose.leftHip.x + pose.rightHip.x) / 2;
  const cy = (pose.leftHip.y + pose.rightHip.y) / 2;
  const out = {} as WorldPose;
  for (const [name, k] of Object.entries(pose) as [KeypointName, Keypoint][]) {
    out[name] = { x: (k.x - cx) / 250, y: (k.y - cy) / 250, z: 0, visibility: k.visibility };
  }
  return out;
}

function jitter(frame: number, k: number): number {
  return 0.8 * Math.sin(frame * 12.9898 + k * 78.233);
}

export function syntheticServe(opts: SyntheticOptions = {}): SyntheticServe {
  const {
    fps = 60, hand = 'right', frontToeY = -0.2, footVisibility = 0.95,
    armVisibility = 0.95, cameraY = -4.5, jump = true, backFootDelayS = 0, airTuck = false,
  } = opts;
  const cam = makeCamera(cameraY);
  const toss: Side = hand === 'right' ? 'left' : 'right';
  const front: Side = toss; // a right-hander's front foot is the left foot
  const back: Side = hand;
  const durationS = 2.6;
  const frames: PoseFrame[] = [];
  const nFrames = Math.floor(durationS * fps);

  // Standing foot positions on court (m), relative to the front toe.
  const feet: Record<string, Vec3> = {
    [`${front}Toe`]: [0.3, frontToeY, 0],
    [`${front}Heel`]: [0.1, frontToeY - 0.2, 0],
    [`${front}Ankle`]: [0.13, frontToeY - 0.15, 0.09],
    [`${back}Toe`]: [0.0, frontToeY - 0.5, 0],
    [`${back}Heel`]: [-0.25, frontToeY - 0.6, 0],
    [`${back}Ankle`]: [-0.2, frontToeY - 0.57, 0.09],
  };

  const legSegment: Partial<Record<Side, number>> = {};
  for (let i = 0; i < nFrames; i++) {
    const t = i / fps;
    const pose = {} as Pose;
    let k = 0;
    const set = (name: KeypointName, x: number, y: number, visibility: number) => {
      k++;
      pose[name] = { x: x + jitter(i, k), y: y + jitter(i, k + 100), visibility } satisfies Keypoint;
    };
    const { z, dy } = footMotion(t, jump);
    for (const [name, [x, y, z0]] of Object.entries(feet)) {
      const m = name.startsWith(back) ? footMotion(t - backFootDelayS, jump) : { z, dy };
      // Back heel kicked up behind, most at the apex of the jump.
      const tuck = airTuck && name.startsWith(back) && t > PUSH_OFF_S && t < EVENT_TIMES_S.landing
        ? 0.35 * Math.sin((Math.PI * (t - PUSH_OFF_S)) / (EVENT_TIMES_S.landing - PUSH_OFF_S)) : 0;
      const p = cam.project([x, y + m.dy, z0 + m.z + tuck]);
      set(name as KeypointName, p.x, p.y, footVisibility);
    }
    const bodyX = cam.project([0.1, frontToeY - 0.3 + dy, 0]).x;
    const groundY = cam.project([0.1, frontToeY - 0.3 + dy, z]).y;
    const lift = cam.project([0.1, frontToeY - 0.3 + dy, 0]).y - groundY
      - (cam.project([0.1, frontToeY - 0.3 + dy, -landingSink(t, jump)]).y - cam.project([0.1, frontToeY - 0.3 + dy, 0]).y);
    set('nose', bodyX, 250 - lift, 0.95);
    set('leftShoulder', bodyX - 25, 330 - lift, 0.95);
    set('rightShoulder', bodyX + 25, 330 - lift, 0.95);
    set('leftHip', bodyX - 18, 440 - lift, 0.95);
    set('rightHip', bodyX + 18, 440 - lift, 0.95);
    // Knees from the hip and ankle with fixed thigh/shin lengths, bending forward (+x): a relaxed
    // bend when standing (stable under jitter), more bent when the ankle comes up toward the hip.
    for (const side of ['left', 'right'] as const) {
      const hip = pose[`${side}Hip`], ankle = pose[`${side}Ankle`];
      const d = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
      legSegment[side] ??= 0.6 * d;
      const l = legSegment[side]!;
      const h = Math.sqrt(Math.max(0, l * l - (d / 2) ** 2));
      const ux = (ankle.x - hip.x) / d, uy = (ankle.y - hip.y) / d;
      set(`${side}Knee`, (hip.x + ankle.x) / 2 + h * Math.abs(uy), (hip.y + ankle.y) / 2 - h * ux * Math.sign(uy || 1), 0.95);
    }
    set(`${hand}Wrist`, bodyX + 60, keyframes(HIT_WRIST_Y, t), armVisibility);
    set(`${hand}Elbow`, bodyX + 45, keyframes(HIT_ELBOW_Y, t), armVisibility);
    set(`${toss}Wrist`, bodyX - 40, keyframes(TOSS_WRIST_Y, t), armVisibility);
    set(`${toss}Elbow`, bodyX - 35, keyframes(TOSS_ELBOW_Y, t), armVisibility);
    for (const [side, dx] of [[hand, 60], [toss, -40]] as const) {
      const wy = keyframes(side === hand ? HIT_WRIST_Y : TOSS_WRIST_Y, t);
      set(`${side}Index`, bodyX + dx + 6, wy - 12, armVisibility);
      set(`${side}Pinky`, bodyX + dx - 6, wy - 10, armVisibility);
    }
    frames.push({ index: i, timeMs: (i * 1000) / fps, pose, world: flatWorld(pose) });
  }

  const truth = Object.fromEntries(
    Object.entries(EVENT_TIMES_S).map(([name, s]) => [name, Math.round(s * fps)]),
  ) as Record<PhaseName, number>;

  return {
    track: { frames, videoWidth: 1280, videoHeight: 720, model: { name: 'synthetic', version: '1' }, sampling: 'synthetic' },
    imageToCourt: cam.imageToCourt,
    courtToImage: cam.courtToImage,
    truth,
    project: cam.project,
  };
}
