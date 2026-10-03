import { describe, expect, it } from 'vitest';
import type { FootFaultResult } from '../src/analysis/footFault';
import {
  elevation, headingDiff, jointAngle, netRotationAbout, rateServe, scoreChecks, yaw, type MotionInput,
} from '../src/analysis/motion';
import { PARAMS } from '../src/analysis/params';
import type { PhaseResult } from '../src/analysis/phases';
import { smoothingFrames } from '../src/analysis/signals';
import type { KeypointName, PoseTrack } from '../src/pose/types';
import { syntheticServe, type SyntheticOptions } from './fixtures/syntheticServe';

type XYZ = [number, number, number];
type Joints = Partial<Record<KeypointName, XYZ>>;

/** Overwrite world joints on frames [from, to] (inclusive). */
function setRange(track: PoseTrack, from: number, to: number, joints: Joints | ((i: number) => Joints)) {
  for (let i = Math.max(0, from); i <= Math.min(track.frames.length - 1, to); i++) {
    const w = track.frames[i]!.world!;
    const j = typeof joints === 'function' ? joints(i) : joints;
    for (const [name, [x, y, z]] of Object.entries(j) as [KeypointName, XYZ][]) w[name] = { x, y, z, visibility: 0.95 };
  }
}
/** Overwrite image (pixel) joints around one frame. */
function setPose(track: PoseTrack, center: number, joints: Partial<Record<KeypointName, [number, number]>>) {
  for (let i = Math.max(0, center - 3); i <= Math.min(track.frames.length - 1, center + 3); i++) {
    const p = track.frames[i]!.pose!;
    for (const [name, [x, y]] of Object.entries(joints) as [KeypointName, [number, number]][]) p[name] = { x, y, visibility: 0.95 };
  }
}

/** Overwrite world joints around one frame (wider than the smoothing window). */
const setWorld = (track: PoseTrack, center: number, joints: Joints) => setRange(track, center - 3, center + 3, joints);

// World coords: metres, y DOWN, z away from camera. Right-handed server.
const legs = (bendZ: number): Joints => ({
  leftHip: [-0.1, 0, 0], leftKnee: [-0.1, 0.42, -bendZ], leftAnkle: [-0.1, 0.84, 0],
  rightHip: [0.1, 0, 0], rightKnee: [0.1, 0.42, -bendZ], rightAnkle: [0.1, 0.84, 0],
});
const DEEP_KNEES = legs(0.3); // ~70° flexion
const STRAIGHT_LEGS = legs(0);

const footFault = (verdict: FootFaultResult['verdict'], minMarginCm = 10): FootFaultResult => ({
  verdict, reason: 'test', minMarginCm, bandCm: 5, foot: 'left', frameIndex: 50, groundedMs: 500, samples: [],
});

function setup(opts: SyntheticOptions = {}) {
  const s = syntheticServe(opts);
  const phases: PhaseResult = { events: { ...s.truth }, warnings: [] };
  const input: MotionInput = {
    track: s.track, phases, hand: opts.hand ?? 'right', footFault: footFault('legal'), imageToCourt: s.imageToCourt,
    params: PARAMS.motion, phaseParams: PARAMS.phases, smoothingWindow: smoothingFrames(s.track, PARAMS.smoothingWindowMs),
  };
  return { s, input };
}
const check = (r: ReturnType<typeof rateServe>, id: string) => r.checks.find((c) => c.id === id)!;

describe('geometry helpers', () => {
  it('jointAngle: straight = 180, right angle = 90', () => {
    expect(jointAngle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBeCloseTo(180, 6);
    expect(jointAngle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 })).toBeCloseTo(90, 6);
  });
  it('elevation: up is +90 (y points down), level is 0', () => {
    expect(elevation({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(90, 6);
    expect(elevation({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0, 6);
  });
  it('yaw and headingDiff handle wrap-around', () => {
    expect(yaw({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeCloseTo(90, 6);
    expect(headingDiff(170, -170)).toBeCloseTo(20, 6);
    expect(headingDiff(10, 40)).toBeCloseTo(30, 6);
  });
  it('netRotationAbout: a hand turning 90° around a vertical forearm, with jitter cancelling', () => {
    const f = Array.from({ length: 10 }, () => ({ x: 0, y: -1, z: 0 }));
    const h = Array.from({ length: 10 }, (_, i) => {
      const jitter = i === 0 || i === 9 ? 0 : i % 2 ? 0.02 : -0.02; // interior frames only, so the net turn is exactly 90°
      const a = (i * 10 * Math.PI) / 180 + jitter;
      return { x: Math.cos(a), y: 0.1, z: Math.sin(a) };
    });
    expect(Math.abs(netRotationAbout(f, h))).toBeCloseTo(90, 0);
  });
});

describe('scoreChecks', () => {
  it('weighted average of good=1, ok=½, work_on=0; unmeasured left out', () => {
    expect(scoreChecks([{ status: 'good', weight: 2 }, { status: 'good', weight: 1 }], 0.6).score).toBe(100);
    expect(scoreChecks([{ status: 'good', weight: 2 }, { status: 'work_on', weight: 2 }], 0.6).score).toBe(50);
    expect(scoreChecks([{ status: 'ok', weight: 1 }, { status: 'good', weight: 1 }, { status: 'unmeasured', weight: 0.5 }], 0.6).score).toBe(75);
  });
  it('no score when too little was measured', () => {
    const r = scoreChecks([{ status: 'good', weight: 1 }, { status: 'unmeasured', weight: 3 }], 0.6);
    expect(r.score).toBeNull();
    expect(r.coverage).toBeCloseTo(0.25, 6);
  });
});

describe('rateServe: legs & power', () => {
  it('knee bend: finds the deepest bend between start and contact, ignoring the landing', () => {
    const { s, input } = setup();
    setRange(s.track, 0, s.truth.contact, STRAIGHT_LEGS);
    setWorld(s.track, s.truth.landing, DEEP_KNEES);
    expect(check(rateServe(input), 'knee_bend').status).toBe('work_on');

    setWorld(s.track, s.truth.trophy, DEEP_KNEES);
    const c = check(rateServe(input), 'knee_bend');
    expect(c.status).toBe('good');
    expect(Math.abs(c.frameIndex! - s.truth.trophy)).toBeLessThanOrEqual(3);
  });

  it('leg drive: fast knee straightening is good, a slow one is flagged', () => {
    const { s, input } = setup();
    // Deep bend held to just before contact, then snapped straight over ~4 frames (60 fps).
    setRange(s.track, 0, s.truth.contact - 6, DEEP_KNEES);
    setRange(s.track, s.truth.contact - 5, s.truth.contact + 5, (i) => legs(Math.max(0, 0.3 * (1 - (i - (s.truth.contact - 6)) / 4))));
    const fast = check(rateServe(input), 'leg_drive');
    expect(fast.status).toBe('good');
    expect(fast.value).toBeGreaterThan(PARAMS.motion.legDriveDegPerS.good);

    // Same bend released over the whole 0.6 s from trophy to contact.
    const n = s.truth.contact - s.truth.trophy;
    setRange(s.track, 0, s.truth.trophy, DEEP_KNEES);
    setRange(s.track, s.truth.trophy, s.truth.contact + 5, (i) => legs(Math.max(0, 0.3 * (1 - (i - s.truth.trophy) / n))));
    expect(check(rateServe(input), 'leg_drive').status).toBe('work_on');
  });

  it('landing foot: front first is good, back first is flagged, together is close', () => {
    expect(check(rateServe(setup({ backFootDelayS: 0.1 }).input), 'landing_foot').status).toBe('good');
    expect(check(rateServe(setup({ backFootDelayS: -0.1 }).input), 'landing_foot').status).toBe('work_on');
    expect(check(rateServe(setup({ backFootDelayS: 0 }).input), 'landing_foot').status).toBe('ok');
  });

  it('driving into the court: measures landing distance inside the baseline', () => {
    const { input } = setup({ frontToeY: -0.2 }); // lands 0.6 m further forward → ~40 cm inside
    const c = check(rateServe(input), 'court_drive');
    expect(c.status).toBe('good');
    expect(c.value).toBeGreaterThan(30);
    expect(c.value).toBeLessThan(50);
    expect(check(rateServe({ ...input, imageToCourt: null }), 'court_drive').status).toBe('unmeasured');
  });
});

describe('rateServe: rotation', () => {
  const shouldersAt = (deg: number): Joints => {
    const a = (deg * Math.PI) / 180;
    return { leftShoulder: [-0.2 * Math.cos(a), -0.5, -0.2 * Math.sin(a)], rightShoulder: [0.2 * Math.cos(a), -0.5, 0.2 * Math.sin(a)] };
  };

  it('staying side-on: a big shoulder turn still to make from trophy to contact is good; little turn is flagged', () => {
    const { s, input } = setup();
    setWorld(s.track, s.truth.trophy, shouldersAt(0));
    setWorld(s.track, s.truth.contact, shouldersAt(90));
    expect(check(rateServe(input), 'side_on').status).toBe('good');
    setWorld(s.track, s.truth.contact, shouldersAt(15)); // already opened up before the trophy
    expect(check(rateServe(input), 'side_on').status).toBe('work_on');
  });

  it('shoulder tilt: front (tossing) shoulder above the hitting shoulder is good', () => {
    const { s, input } = setup();
    setWorld(s.track, s.truth.trophy, { leftShoulder: [-0.2, -0.62, 0], rightShoulder: [0.2, -0.48, 0] }); // ~19° tilt
    expect(check(rateServe(input), 'shoulder_tilt').status).toBe('good');
    setWorld(s.track, s.truth.trophy, { leftShoulder: [-0.2, -0.45, 0], rightShoulder: [0.2, -0.5, 0] });
    expect(check(rateServe(input), 'shoulder_tilt').status).toBe('work_on');
  });

  it('hip–shoulder separation: shoulders coiled past the hips is good', () => {
    const { s, input } = setup();
    setWorld(s.track, s.truth.trophy, { ...shouldersAt(30), leftHip: [-0.15, 0, 0], rightHip: [0.15, 0, 0] });
    expect(check(rateServe(input), 'separation').status).toBe('good');
    setWorld(s.track, s.truth.trophy, { ...shouldersAt(0), leftHip: [-0.15, 0, 0], rightHip: [0.15, 0, 0] });
    expect(check(rateServe(input), 'separation').status).toBe('work_on');
  });
});

describe('rateServe: arm & contact', () => {
  it('arm extension (measured on the image): straight is good, bent is flagged with a tip and joints to draw', () => {
    const { s, input } = setup();
    setPose(s.track, s.truth.contact, { rightShoulder: [700, 330], rightElbow: [705, 250], rightWrist: [710, 170] });
    expect(check(rateServe(input), 'contact_extension').status).toBe('good');
    setPose(s.track, s.truth.contact, { rightShoulder: [700, 330], rightElbow: [705, 250], rightWrist: [780, 200] }); // ~120°
    const c = check(rateServe(input), 'contact_extension');
    expect(c.status).toBe('work_on');
    expect(c.tip).toBeTruthy();
    expect(c.joints).toEqual(['rightShoulder', 'rightElbow', 'rightWrist']);
  });

  it('trophy elbow: elbow well below the shoulder is flagged', () => {
    const { s, input } = setup();
    setWorld(s.track, s.truth.trophy, { rightShoulder: [0.2, -0.5, 0], rightElbow: [0.3, -0.2, 0] });
    expect(check(rateServe(input), 'trophy_elbow').status).toBe('work_on');
    setWorld(s.track, s.truth.trophy, { rightShoulder: [0.2, -0.5, 0], rightElbow: [0.5, -0.52, 0] });
    expect(check(rateServe(input), 'trophy_elbow').status).toBe('good');
  });

  it('contact height (image, torso-scaled): full stretch vs. a low contact; uses the lower ankle', () => {
    const { s, input } = setup();
    const body: Partial<Record<KeypointName, [number, number]>> = { leftShoulder: [675, 330], rightShoulder: [725, 330], leftHip: [682, 440], rightHip: [718, 440] }; // torso 110 px
    setPose(s.track, s.truth.start, { ...body, nose: [700, 250], leftAnkle: [690, 650], rightAnkle: [710, 650] }); // 400 px ankle→nose
    // Back foot kicked up to y=560 must not shrink the reach: the lower ankle (650) is used.
    setPose(s.track, s.truth.contact, { ...body, leftAnkle: [690, 650], rightAnkle: [740, 560], rightWrist: [720, 90] }); // 560 px → 1.4×
    expect(check(rateServe(input), 'contact_height').status).toBe('good');
    setPose(s.track, s.truth.contact, { ...body, leftAnkle: [690, 650], rightAnkle: [740, 560], rightWrist: [720, 250] }); // 400 px → 1.0×
    expect(check(rateServe(input), 'contact_height').status).toBe('work_on');
  });

  it('pronation: forearm turning through contact is measured; needs 50+ fps', () => {
    const { s, input } = setup();
    const c = s.truth.contact;
    // Forearm vertical; hand-across vector turns 120° over the window around contact.
    setRange(s.track, c - 10, c + 15, (i) => {
      const a = (Math.max(0, Math.min(1, (i - (c - 4)) / 12)) * 120 * Math.PI) / 180;
      return {
        rightElbow: [0.2, -0.8, 0], rightWrist: [0.2, -1.1, 0],
        rightIndex: [0.2 + 0.04 * Math.cos(a), -1.18, 0.04 * Math.sin(a)],
        rightPinky: [0.2 - 0.04 * Math.cos(a), -1.18, -0.04 * Math.sin(a)],
      };
    });
    const r = check(rateServe(input), 'pronation');
    expect(r.status).toBe('good');
    expect(r.value).toBeGreaterThan(90);

    const slow = setup({ fps: 30 });
    expect(check(rateServe(slow.input), 'pronation').status).toBe('unmeasured');
  });

  it('pronation: no forearm rotation is flagged', () => {
    const { s, input } = setup();
    setRange(s.track, s.truth.contact - 10, s.truth.contact + 15, {
      rightElbow: [0.2, -0.8, 0], rightWrist: [0.2, -1.1, 0], rightIndex: [0.24, -1.18, 0], rightPinky: [0.16, -1.18, 0],
    });
    expect(check(rateServe(input), 'pronation').status).toBe('work_on');
  });
});

describe('rateServe: overall', () => {
  it('foot fault maps to the foot position check', () => {
    const { input } = setup();
    expect(check(rateServe({ ...input, footFault: footFault('legal') }), 'foot_fault').status).toBe('good');
    expect(check(rateServe({ ...input, footFault: footFault('too_close', 1) }), 'foot_fault').status).toBe('ok');
    expect(check(rateServe({ ...input, footFault: footFault('fault', -8) }), 'foot_fault').status).toBe('work_on');
    expect(check(rateServe({ ...input, footFault: null }), 'foot_fault').status).toBe('unmeasured');
  });

  it('has 14 checks across 4 categories, each with a category score', () => {
    const r = rateServe(setup().input);
    expect(r.checks).toHaveLength(14);
    expect(Object.keys(r.categories).sort()).toEqual(['arm', 'legs', 'rotation', 'rules']);
  });

  it('work-on items come first in the list', () => {
    const { s, input } = setup();
    setPose(s.track, s.truth.contact, { rightShoulder: [700, 330], rightElbow: [705, 250], rightWrist: [780, 200] });
    const r = rateServe({ ...input, footFault: footFault('fault', -8) });
    const firstGood = r.checks.findIndex((c) => c.status === 'good');
    const lastWorkOn = r.checks.map((c) => c.status).lastIndexOf('work_on');
    expect(lastWorkOn).toBeLessThan(firstGood === -1 ? Infinity : firstGood);
  });

  it('no score when the pose is missing; never throws', () => {
    const { s, input } = setup();
    for (const f of s.track.frames) {
      f.world = null;
      f.pose = null;
    }
    const r = rateServe({ ...input, footFault: null, imageToCourt: null });
    expect(r.score).toBeNull();
  });

  it('missing phases → those checks are unmeasured, not wrong', () => {
    const { input } = setup();
    const r = rateServe({ ...input, phases: { events: { start: null, trophy: null, racketDrop: null, contact: null, landing: null }, warnings: [] } });
    for (const c of r.checks.filter((c) => c.id !== 'foot_fault')) expect(c.status, c.id).toBe('unmeasured');
  });
});
