/**
 * Serve phase detection. Tests: tests/phases.test.ts
 * Image y points DOWN, so "highest" = smallest y.
 */
import type { KeypointName, PoseTrack, Side } from '../pose/types';
import type { PhaseParams } from './params';
import { argMax, argMin, frameAtOrAfter, frameTimes, smooth, smoothedKeypoint, type PointSeries, type Series } from './signals';

export type PhaseName = 'start' | 'trophy' | 'racketDrop' | 'contact' | 'landing';
export const PHASE_ORDER: PhaseName[] = ['start', 'trophy', 'racketDrop', 'contact', 'landing'];

export interface PhaseResult {
  /** Frame index into track.frames, or null if not found. */
  events: Record<PhaseName, number | null>;
  /** Human-readable problems, e.g. "landing not detected", "events out of order". */
  warnings: string[];
}

export interface PhaseInput {
  track: PoseTrack;
  /** The player's hitting hand. The other hand tosses. */
  hand: Side;
  params: PhaseParams;
  smoothingWindow: number;
  /** Contact frame chosen by the user. When set, it replaces automatic contact detection and the other events are found around it. */
  contactFrame?: number | null;
}

/** Per frame: deepest knee flexion of either leg (180° − hip-knee-ankle angle), from the 3D pose if present. */
function kneeFlexion(track: PoseTrack, w: number): Series {
  const raw: Series = track.frames.map((f) => {
    const src = f.world ?? f.pose;
    if (!src) return null;
    let best: number | null = null;
    for (const side of ['left', 'right'] as const) {
      const h = src[`${side}Hip`], k = src[`${side}Knee`], a = src[`${side}Ankle`];
      if (!h || !k || !a || h.visibility < 0.5 || k.visibility < 0.5 || a.visibility < 0.5) continue;
      const z = (p: typeof h) => ('z' in p ? (p as { z: number }).z : 0);
      const u = [h.x - k.x, h.y - k.y, z(h) - z(k)], v = [a.x - k.x, a.y - k.y, z(a) - z(k)];
      const cos = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(...u) * Math.hypot(...v));
      const flex = 180 - (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      best = best === null ? flex : Math.max(best, flex);
    }
    return best;
  });
  return smooth(raw, w);
}

type Body = { hipX: number; hipY: number; torso: number } | null;

/** Per frame: hip midpoint and shoulder-to-hip length in pixels (smoothed). */
function bodyFrame(track: PoseTrack, w: number): Body[] {
  const ls = smoothedKeypoint(track, 'leftShoulder', w), rs = smoothedKeypoint(track, 'rightShoulder', w);
  const lh = smoothedKeypoint(track, 'leftHip', w), rh = smoothedKeypoint(track, 'rightHip', w);
  return track.frames.map((_, i) => {
    const v = [ls.x[i], ls.y[i], rs.x[i], rs.y[i], lh.x[i], lh.y[i], rh.x[i], rh.y[i]];
    if (v.some((x) => x === null || x === undefined)) return null;
    const [a, b, c, d, e, f, g, h] = v as number[];
    const torso = Math.hypot((a! + c!) / 2 - (e! + g!) / 2, (b! + d!) / 2 - (f! + h!) / 2);
    return torso > 0 ? { hipX: (e! + g!) / 2, hipY: (f! + h!) / 2, torso } : null;
  });
}

/** Speed of a point relative to the hips, in torso lengths per second, so camera pans and zoom cancel out. */
function bodyRelativeSpeed(p: PointSeries, body: Body[], times: number[]): Series {
  const rel = (i: number) => {
    const b = body[i];
    return b && p.x[i] != null && p.y[i] != null ? { x: (p.x[i]! - b.hipX) / b.torso, y: (p.y[i]! - b.hipY) / b.torso } : null;
  };
  return times.map((_, i) => {
    const a = rel(i - 1), c = rel(i + 1);
    return a && c ? Math.hypot(c.x - a.x, c.y - a.y) / ((times[i + 1]! - times[i - 1]!) / 1000) : null;
  });
}

/** Vertical hip speed in torso lengths per second (positive = moving down the picture). */
function hipVerticalSpeed(body: Body[], times: number[]): Series {
  return times.map((_, i) => {
    const a = body[i - 1], b = body[i], c = body[i + 1];
    return a && b && c ? (c.hipY - a.hipY) / b.torso / ((times[i + 1]! - times[i - 1]!) / 1000) : null;
  });
}

/**
 * Start: the first frame of the continuous arm motion that leads into the toss. From the toss
 * arm's fastest moment before release, walk back while either arm is still moving; a pause longer
 * than `startGapMs` is the ready position (or the end of the pre-serve ball bounces).
 */
export function findStart(tossSpeed: Series, hitSpeed: Series, times: number[], release: number, p: PhaseParams): number | null {
  const from = frameAtOrAfter(times, times[release]! - p.startLookbackMs);
  const peak = argMax(tossSpeed, from, release + 1);
  if (peak === null) return null;
  let start = peak;
  for (let i = peak - 1; i >= from; i--) {
    if (Math.max(tossSpeed[i] ?? 0, hitSpeed[i] ?? 0) >= p.startMinArmSpeed) start = i;
    else if (times[start]! - times[i]! > p.startGapMs) break;
  }
  return start;
}

/**
 * Landing from the hips: in the air they speed up as they fall, and they start to brake once the
 * legs take the weight. The fastest downward moment comes `landingHipLagMs` after the first foot
 * touches (the legs need a moment to start braking), so landing is that moment minus the lag.
 * No clear drop = no jump.
 */
export function findLandingFromHips(hipSpeed: Series, times: number[], contact: number, p: PhaseParams): number | null {
  const end = frameAtOrAfter(times, times[contact]! + p.landingSearchMs);
  const peak = argMax(hipSpeed, contact + 1, end);
  if (peak === null || hipSpeed[peak]! < p.landingMinHipDropSpeed) return null;
  return Math.max(contact + 1, Math.min(peak, frameAtOrAfter(times, times[peak]! - p.landingHipLagMs - 0.5 * ((times[1] ?? 0) - (times[0] ?? 0)))));
}

/**
 * Landing (per foot, used for "which foot lands first"): first frame after contact where any foot point is stationary for `landingStillMs`,
 * after some foot point has first moved fast (otherwise the player never left the ground).
 */
export function findLanding(footSpeeds: Series[], timesMs: number[], contact: number, p: PhaseParams): number | null {
  let moved = false;
  for (let i = contact + 1; i < timesMs.length; i++) {
    if (!moved) {
      moved = footSpeeds.some((s) => (s[i] ?? 0) > p.landingMovingSpeed);
      continue;
    }
    for (const s of footSpeeds) {
      let still = true;
      let j = i;
      for (; j < timesMs.length && timesMs[j]! - timesMs[i]! < p.landingStillMs; j++) {
        if (s[j] === null || s[j]! >= p.landingStillSpeed) {
          still = false;
          break;
        }
      }
      // Require the whole still window to fit inside the clip.
      if (still && j < timesMs.length) return i;
    }
  }
  return null;
}

/**
 * Find the five serve events in this order: contact, trophy, start, racket drop, landing.
 * Missing events are null with a warning. Never throws on bad data.
 */
export function detectPhases({ track, hand, params, smoothingWindow: w, contactFrame }: PhaseInput): PhaseResult {
  const toss: Side = hand === 'right' ? 'left' : 'right';
  const times = frameTimes(track);
  const warnings: string[] = [];
  const events: PhaseResult['events'] = { start: null, trophy: null, racketDrop: null, contact: null, landing: null };

  // Heights are measured from the hips in torso lengths, frame by frame, so a camera that pans or
  // zooms (e.g. SwingVision exports) doesn't change them.
  const body = bodyFrame(track, w);
  // Arms use a lower visibility cutoff: the racket arm is always blurred near contact, and
  // smoothing's despike step removes the odd bad point.
  const rel = (name: KeypointName): Series =>
    smoothedKeypoint(track, name, w, params.armMinVisibility).y.map((y, i) => (y === null || body[i] === null ? null : (y - body[i]!.hipY) / body[i]!.torso));
  const hitWrist = { y: rel(`${hand}Wrist`) };
  const hitElbow = { y: rel(`${hand}Elbow`) };
  const tossWrist = { y: rel(`${toss}Wrist`) };
  const armSpeed = (name: KeypointName) => bodyRelativeSpeed(smoothedKeypoint(track, name, w, params.armMinVisibility), body, times);
  const hipSpeed = hipVerticalSpeed(body, times);

  // Contact: the hitting hand peaks just before the racket meets the ball, so contact is the
  // wrist's highest point plus a short delay. A frame chosen by the user is used as-is.
  const wristPeak = argMin(hitWrist.y);
  const contact =
    contactFrame !== null && contactFrame !== undefined && contactFrame >= 0 && contactFrame < times.length
      ? contactFrame
      : wristPeak === null
        ? null
        : Math.min(times.length - 1, frameAtOrAfter(times, times[wristPeak]! + params.contactAfterWristPeakMs - 0.5 * ((times[1] ?? 0) - (times[0] ?? 0))));
  events.contact = contact;
  if (contact === null) {
    warnings.push('contact not detected: hitting arm not visible');
  } else {
    // Ball release ≈ the toss hand at its highest before contact.
    const release = argMin(tossWrist.y, 0, contact);
    if (release === null) {
      warnings.push('trophy not detected: tossing arm not visible before contact');
    } else {
      // Trophy: the deepest knee bend between release and push-off (the usual definition in serve
      // biomechanics). Push-off = the hips' fastest rise, which comes at take-off; from there the legs
      // can tuck in the air, which isn't a crouch. If the knees barely bend, fall back to the release.
      const flex = kneeFlexion(track, w);
      const pushOff = argMin(hipSpeed, release + 1, contact);
      const searchEnd = pushOff === null ? contact : frameAtOrAfter(times, times[pushOff]! - params.trophyBeforePushOffMs);
      const deepest = argMax(flex, release, searchEnd > release + 1 ? searchEnd : contact);
      const atRelease = flex[release];
      events.trophy =
        deepest !== null && atRelease !== null && atRelease !== undefined && flex[deepest]! - atRelease >= params.trophyMinExtraBendDeg
          ? deepest
          : release;
      events.start = findStart(armSpeed(`${toss}Wrist`), armSpeed(`${hand}Wrist`), times, release, params);
      // Racket drop: elbow up, hand dropped behind the back → wrist furthest below the elbow, counted
      // only while the elbow is up near shoulder height (a hand just hanging low doesn't count).
      const hitShoulder = rel(`${hand}Shoulder`);
      const wristBelowElbow: Series = hitWrist.y.map((y, i) => (y === null || hitElbow.y[i] === null ? null : y - hitElbow.y[i]!));
      const elbowUp: Series = wristBelowElbow.map((v, i) =>
        v !== null && hitShoulder[i] != null && hitElbow.y[i]! <= hitShoulder[i]! + params.elbowUpTolerance ? v : null,
      );
      events.racketDrop = argMax(elbowUp, events.trophy + 1, contact) ?? argMax(wristBelowElbow, events.trophy + 1, contact);
      if (events.racketDrop === null) {
        // The racket arm is a blur here on most phone footage; use the usual drop-to-contact time.
        const est = frameAtOrAfter(times, times[contact]! - params.racketDropBeforeContactMs);
        if (est > events.trophy && est < contact) {
          events.racketDrop = est;
          warnings.push('racket drop estimated: hitting arm not visible behind the back');
        }
      }
    }

    events.landing = findLandingFromHips(hipSpeed, times, contact, params);
    if (events.landing === null) warnings.push('landing not detected: no jump, or hips not visible after contact');
  }

  for (const name of PHASE_ORDER) {
    if (events[name] === null && !warnings.some((m) => m.startsWith(name === 'racketDrop' ? 'racket drop' : name))) {
      warnings.push(`${name === 'racketDrop' ? 'racket drop' : name} not detected`);
    }
  }
  const found = PHASE_ORDER.map((n) => events[n]).filter((v): v is number => v !== null);
  if (found.some((v, i) => i > 0 && v <= found[i - 1]!)) warnings.push('events out of order: check the video and the contact frame');

  return { events, warnings };
}
