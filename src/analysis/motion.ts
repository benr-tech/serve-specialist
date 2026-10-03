/**
 * Whole-serve motion checklist and score. Tests: tests/motion.test.ts
 *
 * Each check is one measurement at a known moment of the serve (from detectPhases), compared
 * against thresholds in PARAMS.motion (marked TUNE: rules of thumb until compared with coaches).
 * Angles use the 3D world landmarks: x right, y DOWN, z away from the camera, metres, hip-centred.
 * Rotation checks (yaw) lean on the z axis, the model's least certain one.
 */
import { applyHomography } from '../geometry/homography';
import type { Mat3 } from '../geometry/types';
import type { KeypointName, PoseTrack, Side } from '../pose/types';
import type { FootFaultResult } from './footFault';
import type { MotionParams, PhaseParams } from './params';
import { findLanding, type PhaseName, type PhaseResult } from './phases';
import { argMax, frameTimes, smooth, smoothedKeypoint, speed, torsoLengthPx, type Series } from './signals';

export type CheckStatus = 'good' | 'ok' | 'work_on' | 'unmeasured';
export type CheckCategory = 'legs' | 'rotation' | 'arm' | 'rules';
export const CATEGORY_ORDER: CheckCategory[] = ['legs', 'rotation', 'arm', 'rules'];
export const CATEGORY_LABEL: Record<CheckCategory, string> = {
  legs: 'Legs & power',
  rotation: 'Rotation',
  arm: 'Arm & contact',
  rules: 'Rules',
};

export type CheckId =
  | 'knee_bend' | 'leg_drive' | 'landing_foot' | 'court_drive'
  | 'side_on' | 'shoulder_tilt' | 'separation'
  | 'trophy_elbow' | 'toss_arm' | 'racket_drop' | 'contact_extension' | 'contact_height' | 'pronation'
  | 'foot_fault';

export interface MotionCheck {
  id: CheckId;
  category: CheckCategory;
  title: string;
  /** Serve moment this check looks at. */
  phase: PhaseName | null;
  /** Frame to show the user, or null if unmeasured. */
  frameIndex: number | null;
  /** The measurement in plain words, e.g. "Deepest knee bend: 32°". */
  measured: string | null;
  value: number | null;
  status: CheckStatus;
  /** What to do about it. Present when status is 'ok' or 'work_on'. */
  tip: string | null;
  weight: number;
  /** Three joints to draw as an angle on the video (middle = vertex). */
  joints: [KeypointName, KeypointName, KeypointName] | null;
  /** 'rough' when the joints it used were only faintly visible. */
  confidence: 'normal' | 'rough';
}

export interface MotionResult {
  /** 0–100 weighted checklist score, or null if too little could be measured. */
  score: number | null;
  /** Share of total check weight that could be measured (0–1). */
  coverage: number;
  /** 'rough' when few checks could be measured, many were rough, or the footage is poor (set later). */
  confidence: 'normal' | 'rough';
  measuredCount: number;
  categories: Record<CheckCategory, { score: number | null; coverage: number }>;
  /** Ordered for display: things to work on first. */
  checks: MotionCheck[];
}

export interface MotionInput {
  track: PoseTrack;
  phases: PhaseResult;
  hand: Side;
  /** null when the foot-fault check wasn't run. */
  footFault: FootFaultResult | null;
  /** image px → court metres; null when the court wasn't marked. */
  imageToCourt: Mat3 | null;
  params: MotionParams;
  phaseParams: PhaseParams;
  smoothingWindow: number;
}

// ---------- 3D geometry ----------
type Vec = { x: number; y: number; z: number };
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (v: Vec) => Math.hypot(v.x, v.y, v.z);
const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k, z: v.z * k });
const DEG = 180 / Math.PI;

/** Angle at b (degrees) between segments b→a and b→c. 180 = straight. */
export function jointAngle(a: Vec, b: Vec, c: Vec): number {
  const u = sub(a, b), v = sub(c, b);
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v))))) * DEG;
}

/** Elevation (degrees) of the segment from→to: +90 = straight up, 0 = level, −90 = straight down. y points down. */
export function elevation(from: Vec, to: Vec): number {
  const d = sub(to, from);
  return Math.asin(Math.max(-1, Math.min(1, -d.y / len(d)))) * DEG;
}

/** Heading (degrees) of the segment from→to seen from above (the x–z plane). */
export function yaw(from: Vec, to: Vec): number {
  const d = sub(to, from);
  return Math.atan2(d.z, d.x) * DEG;
}

/** Smallest absolute difference between two headings, 0–180°. */
export function headingDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/**
 * Net rotation (degrees) of the hand-across vectors `h` about the forearm axes `f`, summed frame
 * to frame. Each h is projected onto the plane perpendicular to its forearm, and the step between
 * frames is signed by the right-hand rule around the forearm, so back-and-forth jitter cancels.
 */
export function netRotationAbout(f: Vec[], h: Vec[]): number {
  let total = 0;
  const perp = (hv: Vec, fv: Vec) => {
    const u = scale(fv, 1 / len(fv));
    return sub(hv, scale(u, dot(hv, u)));
  };
  for (let i = 0; i + 1 < f.length; i++) {
    const a = perp(h[i]!, f[i]!), b = perp(h[i + 1]!, f[i + 1]!);
    const la = len(a), lb = len(b);
    if (la === 0 || lb === 0) continue;
    const step = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) * DEG;
    const axis = { x: f[i]!.x + f[i + 1]!.x, y: f[i]!.y + f[i + 1]!.y, z: f[i]!.z + f[i + 1]!.z };
    total += dot(cross(a, b), axis) >= 0 ? step : -step;
  }
  return total;
}

// ---------- series helpers ----------
type VecSeries = (Vec | null)[];

/** Smoothed 3D track of one joint; null where not visible. */
function worldPoint(track: PoseTrack, name: KeypointName, w: number, minVis: number): VecSeries {
  const pick = (axis: 'x' | 'y' | 'z'): Series =>
    track.frames.map((f) => {
      const k = f.world?.[name];
      return k && k.visibility >= minVis ? k[axis] : null;
    });
  const xs = smooth(pick('x'), w), ys = smooth(pick('y'), w), zs = smooth(pick('z'), w);
  return xs.map((x, i) => (x === null || ys[i] === null || zs[i] === null ? null : { x, y: ys[i]!, z: zs[i]! }));
}

/** Rate of change per second by central difference on real timestamps. */
function perSecond(s: Series, times: number[]): Series {
  return s.map((_, i) => {
    const a = s[i - 1], b = s[i + 1];
    if (a == null || b == null) return null;
    return (b - a) / ((times[i + 1]! - times[i - 1]!) / 1000);
  });
}

function grade(value: number, t: { good: number; ok: number }): CheckStatus {
  return value >= t.good ? 'good' : value >= t.ok ? 'ok' : 'work_on';
}
/** For measurements where smaller is better. */
function gradeLow(value: number, t: { good: number; ok: number }): CheckStatus {
  return value <= t.good ? 'good' : value <= t.ok ? 'ok' : 'work_on';
}

const STATUS_VALUE: Record<Exclude<CheckStatus, 'unmeasured'>, number> = { good: 1, ok: 0.5, work_on: 0 };

/**
 * Weighted checklist score: good = 1, ok = ½, work on = 0, averaged by weight over the checks that
 * could be measured, × 100. No score if the measured checks cover less than `minCoverage` of the weight.
 */
export function scoreChecks(checks: Pick<MotionCheck, 'status' | 'weight'>[], minCoverage: number): { score: number | null; coverage: number } {
  const total = checks.reduce((a, c) => a + c.weight, 0);
  let measuredWeight = 0;
  let earned = 0;
  for (const c of checks) {
    if (c.status === 'unmeasured') continue;
    measuredWeight += c.weight;
    earned += c.weight * STATUS_VALUE[c.status];
  }
  const coverage = total > 0 ? measuredWeight / total : 0;
  return { score: coverage >= minCoverage && measuredWeight > 0 ? Math.round((100 * earned) / measuredWeight) : null, coverage };
}

/** Joints each check relies on (for marking faint measurements as rough). */
const CHECK_JOINTS: Record<CheckId, (hand: Side, toss: Side) => KeypointName[]> = {
  knee_bend: () => ['leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle'],
  leg_drive: () => ['leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle'],
  landing_foot: () => ['leftToe', 'rightToe'],
  court_drive: () => ['leftToe', 'rightToe'],
  side_on: () => ['leftShoulder', 'rightShoulder'],
  shoulder_tilt: () => ['leftShoulder', 'rightShoulder'],
  separation: () => ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'],
  trophy_elbow: (h) => [`${h}Hip`, `${h}Shoulder`, `${h}Elbow`],
  toss_arm: (_h, t) => [`${t}Shoulder`, `${t}Elbow`, `${t}Wrist`],
  racket_drop: (h) => [`${h}Shoulder`, `${h}Elbow`, `${h}Wrist`],
  contact_extension: (h) => [`${h}Shoulder`, `${h}Elbow`, `${h}Wrist`],
  contact_height: (h) => ['nose', `${h}Wrist`],
  pronation: (h) => [`${h}Elbow`, `${h}Wrist`, `${h}Index`, `${h}Pinky`],
  foot_fault: () => [],
};

const phaseName = (p: PhaseName) => (p === 'racketDrop' ? 'racket drop' : p);

export function rateServe(input: MotionInput): MotionResult {
  const { track, phases, hand, footFault, imageToCourt, params: p, phaseParams, smoothingWindow: w } = input;
  const toss: Side = hand === 'right' ? 'left' : 'right';
  const ev = phases.events;
  const times = frameTimes(track);
  const minVis = p.minVisibility;
  const W = (name: KeypointName) => worldPoint(track, name, w, minVis);
  const checks: MotionCheck[] = [];

  const base = (id: CheckId, category: CheckCategory, title: string, phase: PhaseName | null) => ({
    id, category, title, phase, weight: p.weights[id], confidence: 'normal' as MotionCheck['confidence'],
  });
  const unmeasured = (b: ReturnType<typeof base>, why: string): MotionCheck => ({
    ...b, frameIndex: null, measured: why, value: null, status: 'unmeasured', tip: null, joints: null,
  });
  const result = (
    b: ReturnType<typeof base>, frameIndex: number, value: number | null, status: CheckStatus,
    measured: string, tip: string, joints: MotionCheck['joints'] = null,
  ): MotionCheck => ({ ...b, frameIndex, value, status, measured, tip: status === 'good' ? null : tip, joints });

  /** Smoothed image position (px, z = 0) of one joint; null where not visible. */
  const I = (name: KeypointName): (Vec | null)[] => {
    const k = smoothedKeypoint(track, name, w, minVis);
    return k.x.map((x, i) => (x === null || k.y[i] === null ? null : { x, y: k.y[i]!, z: 0 }));
  };
  const ls2 = I('leftShoulder'), rs2 = I('rightShoulder'), lh2 = I('leftHip'), rh2 = I('rightHip');
  const torso2d = (i: number): number | null => {
    const a = ls2[i], b = rs2[i], c = lh2[i], d = rh2[i];
    return a && b && c && d ? Math.hypot((a.x + b.x - c.x - d.x) / 2, (a.y + b.y - c.y - d.y) / 2) || null : null;
  };
  /** Like atEvent, but on the flat image (for angles near 180°, which the image can't fake). */
  function atEvent2d(phase: PhaseName, joints: KeypointName[], f: (pts: Vec[]) => number): { i: number; v: number } | string {
    const i = ev[phase];
    if (i === null) return `The ${phaseName(phase)} moment wasn't found.`;
    const pts = joints.map((j) => I(j)[i]);
    if (pts.some((q) => !q)) return "Those joints weren't clearly visible at that moment.";
    return { i, v: f(pts as Vec[]) };
  }

  /** Value of `f` at one event, from the listed joints' smoothed 3D positions. */
  function atEvent(phase: PhaseName, joints: KeypointName[], f: (pts: Vec[]) => number): { i: number; v: number } | string {
    const i = ev[phase];
    if (i === null) return `The ${phaseName(phase)} moment wasn't found.`;
    const pts = joints.map((j) => W(j)[i]);
    if (pts.some((q) => !q)) return "Those joints weren't clearly visible at that moment.";
    return { i, v: f(pts as Vec[]) };
  }

  // ---------------- Legs & power ----------------
  const flexion = (side: Side): Series => {
    const hip = W(`${side}Hip`), knee = W(`${side}Knee`), ankle = W(`${side}Ankle`);
    return hip.map((h, i) => (h && knee[i] && ankle[i] ? 180 - jointAngle(h, knee[i]!, ankle[i]!) : null));
  };
  const flexL = flexion('left'), flexR = flexion('right');
  const flexMax: Series = flexL.map((l, i) => (l === null && flexR[i] === null ? null : Math.max(l ?? -Infinity, flexR[i] ?? -Infinity)));
  const deepest = ev.contact === null ? null : argMax(flexMax, ev.start ?? 0, ev.contact + 1);

  {
    const b = base('knee_bend', 'legs', 'Knee bend', 'trophy');
    if (ev.contact === null) checks.push(unmeasured(b, "Contact wasn't found, so there's no loading phase to measure."));
    else if (deepest === null) checks.push(unmeasured(b, "The legs weren't clearly visible before contact."));
    else {
      const v = flexMax[deepest]!;
      const side: Side = (flexL[deepest] ?? -Infinity) >= (flexR[deepest] ?? -Infinity) ? 'left' : 'right';
      checks.push(result(b, deepest, v, grade(v, p.kneeFlexionDeg), `Deepest knee bend before contact: ${Math.round(v)}°`,
        'Sink into your legs more as you toss. A deeper knee bend loads the legs so they can drive you up into the ball.',
        [`${side}Hip`, `${side}Knee`, `${side}Ankle`]));
    }
  }

  {
    const b = base('leg_drive', 'legs', 'Leg drive', 'contact');
    if (ev.contact === null || deepest === null) checks.push(unmeasured(b, "Needs the knee bend and contact to be found."));
    else {
      // Knee extension speed = how fast flexion drops, in degrees per second.
      const extL = perSecond(flexL, times).map((v) => (v === null ? null : -v));
      const extR = perSecond(flexR, times).map((v) => (v === null ? null : -v));
      const ext: Series = extL.map((l, i) => (l === null && extR[i] === null ? null : Math.max(l ?? -Infinity, extR[i] ?? -Infinity)));
      const i = argMax(ext, deepest, ev.contact + 1);
      if (i === null) checks.push(unmeasured(b, "The legs weren't clearly visible while driving up."));
      else {
        const v = ext[i]!;
        const side: Side = (extL[i] ?? -Infinity) >= (extR[i] ?? -Infinity) ? 'left' : 'right';
        checks.push(result(b, i, v, grade(v, p.legDriveDegPerS), `Fastest knee straightening: ${Math.round(v)}°/s`,
          'Explode up out of the knee bend. Push hard off the ground so your legs, not just your arm, start the swing.',
          [`${side}Hip`, `${side}Knee`, `${side}Ankle`]));
      }
    }
  }

  // Which foot lands first, and how far into the court.
  const torso = torsoLengthPx(track);
  const landingOf = (side: Side): number | null => {
    if (ev.contact === null || !torso) return null;
    const sp = (['Toe', 'Heel'] as const).map((part) =>
      speed(smoothedKeypoint(track, `${side}${part}`, w, minVis), times).map((v) => (v === null ? null : v / torso)),
    );
    return findLanding(sp, times, ev.contact, phaseParams);
  };
  const frontLand = landingOf(toss);
  const backLand = landingOf(hand);
  {
    const b = base('landing_foot', 'legs', 'Landing foot', 'landing');
    if (frontLand === null && backLand === null) checks.push(unmeasured(b, 'No landing was detected (no jump, or feet not visible).'));
    else {
      const frameMs = (times[1] ?? 0) - (times[0] ?? 0) || 33;
      const gap = frontLand !== null && backLand !== null ? times[backLand]! - times[frontLand]! : frontLand !== null ? Infinity : -Infinity;
      const status: CheckStatus = Math.abs(gap) <= frameMs * 1.5 ? 'ok' : gap > 0 ? 'good' : 'work_on';
      const first = Math.min(frontLand ?? Infinity, backLand ?? Infinity);
      checks.push(result(b, first, Number.isFinite(gap) ? gap : null, status,
        status === 'good' ? 'Landed on the front foot first' : status === 'ok' ? 'Both feet landed together' : 'Landed on the back foot first',
        'Land on your front foot, inside the court, with the back leg kicking back for balance. It means your legs drove you up and forward.'));
    }
  }
  {
    const b = base('court_drive', 'legs', 'Driving into the court', 'landing');
    const landSide: Side | null = frontLand !== null && (backLand === null || frontLand <= backLand) ? toss : backLand !== null ? hand : null;
    const landFrame = landSide === toss ? frontLand : backLand;
    if (!imageToCourt) checks.push(unmeasured(b, 'Needs the court to be marked.'));
    else if (landSide === null || landFrame === null) checks.push(unmeasured(b, 'No landing was detected.'));
    else {
      const toe = smoothedKeypoint(track, `${landSide}Toe`, w, minVis);
      const i = Math.min(landFrame + 2, track.frames.length - 1); // a moment after touchdown, foot planted
      if (toe.x[i] == null) checks.push(unmeasured(b, "The landing foot wasn't visible."));
      else {
        const cm = 100 * applyHomography(imageToCourt, { x: toe.x[i]!, y: toe.y[i]! }).y;
        checks.push(result(b, i, cm, grade(cm, p.courtDriveCm),
          cm >= 0 ? `Landed ${Math.round(cm)} cm inside the baseline` : `Landed ${Math.round(-cm)} cm behind the baseline`,
          'Drive up and out toward the net so you land inside the court. Landing on or behind the baseline usually means the toss or the drive went straight up.'));
      }
    }
  }

  // ---------------- Rotation ----------------
  const shoulderYaw = (i: number) => {
    const a = W(`${toss}Shoulder`)[i], c = W(`${hand}Shoulder`)[i];
    return a && c ? yaw(a, c) : null;
  };
  {
    // A server who stays side-on until the swing has a big shoulder turn still to make between the
    // trophy and contact; one who opened up early has already used most of it.
    const b = base('side_on', 'rotation', 'Staying side-on', 'contact');
    if (ev.trophy === null || ev.contact === null) checks.push(unmeasured(b, 'Needs the trophy and contact moments.'));
    else {
      const y0 = shoulderYaw(ev.trophy), y1 = shoulderYaw(ev.contact);
      if (y0 === null || y1 === null) checks.push(unmeasured(b, "The shoulders weren't clearly visible."));
      else {
        const v = headingDiff(y0, y1);
        checks.push(result(b, ev.contact, v, grade(v, p.sideOnTurnDeg), `Shoulders turned ${Math.round(v)}° from trophy to contact`,
          'Stay sideways longer. If your chest already faces the net at the trophy, there is little turn left to put into the ball. Keep the shoulders closed until the racket drops, then turn hard.'));
      }
    }
  }
  {
    const r = atEvent('trophy', [`${hand}Shoulder`, `${toss}Shoulder`], ([hs, ts]) => elevation(hs!, ts!));
    const b = base('shoulder_tilt', 'rotation', 'Shoulder tilt', 'trophy');
    checks.push(typeof r === 'string' ? unmeasured(b, r)
      : result(b, r.i, r.v, grade(r.v, p.shoulderTiltDeg), `Front shoulder ${Math.abs(Math.round(r.v))}° ${r.v >= 0 ? 'above' : 'below'} the back shoulder at trophy`,
        'Tilt your shoulders: front shoulder up toward the ball, hitting shoulder down. The tilt is what lets you swing up and through the ball.'));
  }
  {
    const r = atEvent('trophy', [`${toss}Shoulder`, `${hand}Shoulder`, `${toss}Hip`, `${hand}Hip`],
      ([ts, hs, th, hh]) => headingDiff(yaw(ts!, hs!), yaw(th!, hh!)));
    const b = base('separation', 'rotation', 'Hip–shoulder separation', 'trophy');
    checks.push(typeof r === 'string' ? unmeasured(b, r)
      : result(b, r.i, r.v, grade(r.v, p.separationDeg), `Shoulders turned ${Math.round(r.v)}° further than the hips at trophy`,
        'Coil more: turn your shoulders further away from the net than your hips at the trophy. That stretch stores energy for the swing.'));
  }

  // ---------------- Arm & contact ----------------
  {
    // Measured against the trunk, not the ground: with normal shoulder tilt, an elbow in line with
    // the shoulders points well below horizontal.
    const r = atEvent('trophy', [`${hand}Hip`, `${hand}Shoulder`, `${hand}Elbow`], ([h, s2, e]) => jointAngle(h!, s2!, e!));
    const b = base('trophy_elbow', 'arm', 'Hitting elbow at trophy', 'trophy');
    checks.push(typeof r === 'string' ? unmeasured(b, r)
      : result(b, r.i, r.v, grade(r.v, p.trophyArmAbductionDeg), `Upper arm raised ${Math.round(r.v)}° from your side (90° = level with your shoulders)`,
        'Lift your hitting elbow to about shoulder height in the trophy position, so the racket has room to drop and swing up.',
        [`${hand}Hip`, `${hand}Shoulder`, `${hand}Elbow`]));
  }
  {
    const r = atEvent2d('trophy', [`${toss}Shoulder`, `${toss}Elbow`, `${toss}Wrist`], ([s2, e, wr]) => jointAngle(s2!, e!, wr!));
    const b = base('toss_arm', 'arm', 'Tossing arm', 'trophy');
    checks.push(typeof r === 'string' ? unmeasured(b, r)
      : result(b, r.i, r.v, grade(r.v, p.tossArmAngleDeg), `Tossing elbow angle at trophy: ${Math.round(r.v)}° (180° = straight)`,
        'Keep the tossing arm long and straight as you lift the ball. A bent toss arm usually means a less consistent toss.',
        [`${toss}Shoulder`, `${toss}Elbow`, `${toss}Wrist`]));
  }
  {
    const r = atEvent('racketDrop', [`${hand}Shoulder`, `${hand}Elbow`, `${hand}Wrist`], ([s2, e, wr]) => jointAngle(s2!, e!, wr!));
    const b = base('racket_drop', 'arm', 'Racket drop', 'racketDrop');
    checks.push(typeof r === 'string' ? unmeasured(b, r)
      : result(b, r.i, r.v, gradeLow(r.v, p.racketDropElbowDeg), `Elbow bent to ${Math.round(r.v)}° at the drop (smaller = deeper drop)`,
        'Let the racket drop deeper behind your back (elbow up, hand down, arm relaxed) before you swing up.',
        [`${hand}Shoulder`, `${hand}Elbow`, `${hand}Wrist`]));
  }
  {
    // On the flat image a straight arm always looks straight, whatever the camera angle, while the
    // 3D estimate tends to make straight arms look bent (its depth axis is the least certain).
    const r = atEvent2d('contact', [`${hand}Shoulder`, `${hand}Elbow`, `${hand}Wrist`], ([s2, e, wr]) => jointAngle(s2!, e!, wr!));
    const b = base('contact_extension', 'arm', 'Arm extension at contact', 'contact');
    checks.push(typeof r === 'string' ? unmeasured(b, r)
      : result(b, r.i, r.v, grade(r.v, p.contactElbowAngleDeg), `Hitting elbow angle at contact: ${Math.round(r.v)}° (180° = straight)`,
        'Hit at full stretch. Your arm is still bent at contact, which costs height and power.',
        [`${hand}Shoulder`, `${hand}Elbow`, `${hand}Wrist`]));
  }
  {
    // Heights on the image aren't foreshortened from behind, the side or the front. Each moment is
    // scaled by that frame's torso length so camera zoom cancels; the lower ankle is used because
    // the back leg kicks up at contact.
    const b = base('contact_height', 'arm', 'Contact height', 'contact');
    const ref = ev.start ?? 0;
    const nose = I('nose'), la = I('leftAnkle'), ra = I('rightAnkle'), wrist = I(`${hand}Wrist`);
    const lowAnkle = (i: number) => (la[i] || ra[i] ? Math.max(la[i]?.y ?? -Infinity, ra[i]?.y ?? -Infinity) : null);
    if (ev.contact === null) checks.push(unmeasured(b, "Contact wasn't found."));
    else {
      const a0 = lowAnkle(ref), a1 = lowAnkle(ev.contact), t0 = torso2d(ref), t1 = torso2d(ev.contact);
      if (a0 === null || a1 === null || !nose[ref] || !wrist[ev.contact] || !t0 || !t1) {
        checks.push(unmeasured(b, "The whole body wasn't visible at the start and at contact."));
      } else {
        const v = ((a1 - wrist[ev.contact]!.y) / t1) / ((a0 - nose[ref]!.y) / t0);
        checks.push(result(b, ev.contact, v, grade(v, p.contactHeightRatio), `Contact reach: ${v.toFixed(2)}× your standing ankle-to-nose height`,
          'Reach higher: stretch the whole body (legs, trunk and arm) into one line at contact. Higher contact gives more net clearance and better angles.'));
      }
    }
  }
  {
    const b = base('pronation', 'arm', 'Pronation', 'contact');
    const frameMs = times.length > 1 ? (times[times.length - 1]! - times[0]!) / (times.length - 1) : Infinity;
    if (ev.contact === null) checks.push(unmeasured(b, "Contact wasn't found."));
    else if (1000 / frameMs < p.pronation.minFps) checks.push(unmeasured(b, `Needs video at ${p.pronation.minFps}+ fps. Forearm rotation is too fast to see at this frame rate.`));
    else {
      const t0 = times[ev.contact]! - p.pronation.beforeMs, t1 = times[ev.contact]! + p.pronation.afterMs;
      const elbow = W(`${hand}Elbow`), wrist = W(`${hand}Wrist`), index = W(`${hand}Index`), pinky = W(`${hand}Pinky`);
      const f: Vec[] = [], h: Vec[] = [];
      let frames = 0;
      for (let i = 0; i < times.length; i++) {
        if (times[i]! < t0 || times[i]! > t1) continue;
        frames++;
        if (elbow[i] && wrist[i] && index[i] && pinky[i]) {
          f.push(sub(wrist[i]!, elbow[i]!));
          h.push(sub(index[i]!, pinky[i]!));
        }
      }
      if (frames === 0 || f.length / frames < p.pronation.minVisibleShare) checks.push(unmeasured(b, "The hitting hand wasn't clearly visible through contact."));
      else {
        const v = Math.abs(netRotationAbout(f, h));
        checks.push(result(b, ev.contact, v, grade(v, p.pronation.rotationDeg), `Forearm rotated ${Math.round(v)}° through contact`,
          'Let the forearm turn over through contact (racket face rotating out toward the ball). Pronation is where much of the racket speed comes from; a "pushed" serve skips it.',
          [`${hand}Elbow`, `${hand}Wrist`, `${hand}Index`]));
      }
    }
  }

  // ---------------- Rules ----------------
  {
    const b = base('foot_fault', 'rules', 'Foot position', 'contact');
    const v = footFault?.verdict;
    if (!footFault || v === 'cant_tell') checks.push(unmeasured(b, footFault ? footFault.reason : "The court wasn't marked."));
    else {
      const margin = footFault.minMarginCm!;
      const status: CheckStatus = v === 'legal' ? 'good' : v === 'too_close' ? 'ok' : 'work_on';
      checks.push(result(b, footFault.frameIndex!, margin, status,
        v === 'fault' ? `Foot fault: ${Math.abs(margin).toFixed(0)} cm over the line` : `Closest approach: ${Math.abs(margin).toFixed(0)} cm ${margin >= 0 ? 'behind' : 'over'} the line`,
        v === 'fault'
          ? 'Your foot touched the baseline before you hit the ball. Start a little further back, and keep your front foot planted until you jump.'
          : 'Your foot got very close to the line. Give yourself a few more centimetres.'));
    }
  }

  // Mark measurements that leaned on faintly visible joints as rough.
  for (const c of checks) {
    if (c.status === 'unmeasured' || c.frameIndex === null) continue;
    const pose = track.frames[c.frameIndex]?.pose;
    const used = CHECK_JOINTS[c.id](hand, toss);
    if (pose && used.some((j) => (pose[j]?.visibility ?? 0) < p.confidentVisibility)) c.confidence = 'rough';
  }

  const { score, coverage } = scoreChecks(checks, p.minCoverage);
  const categories = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, scoreChecks(checks.filter((k) => k.category === c), 0.01)]),
  ) as MotionResult['categories'];
  const measured = checks.filter((c) => c.status !== 'unmeasured');
  const roughWeight = measured.filter((c) => c.confidence === 'rough').reduce((a, c) => a + c.weight, 0);
  const measuredWeight = measured.reduce((a, c) => a + c.weight, 0);
  const confidence = coverage < p.confidentCoverage || roughWeight > measuredWeight / 3 ? 'rough' : 'normal';
  const order: Record<CheckStatus, number> = { work_on: 0, ok: 1, good: 2, unmeasured: 3 };
  checks.sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);
  return { score, coverage, confidence, measuredCount: measured.length, categories, checks };
}

/** Time of a check's frame, for display. */
export function checkTimeMs(track: PoseTrack, c: MotionCheck): number | null {
  return c.frameIndex === null ? null : (frameTimes(track)[c.frameIndex] ?? null);
}

