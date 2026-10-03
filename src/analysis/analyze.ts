/**
 * Splits a video into clips (one serve each), then runs every analysis module on a clip and
 * collects the results into a report. Each module runs independently, so one failing module
 * doesn't hide the others.
 */
import { calibrate, type Calibration, type CalibrationClick } from '../court/calibration';
import { detectCourt, medianImage } from '../court/detect';
import { fixLeftRightSwaps } from '../pose/consistency';
import type { PoseTrack, Side } from '../pose/types';
import type { Still } from '../video/stills';
import { APP_VERSION } from '../version';
import { judgeFootFault, type FootFaultResult } from './footFault';
import { rateServe, type MotionResult } from './motion';
import { PARAMS } from './params';
import { detectPhases, type PhaseResult } from './phases';
import { assessFootage, DETAIL_ISSUES, type FootageQuality } from './footage';
import { detectHittingSide, findSegments, sliceTrack, type Segment } from './segments';
import { smoothingFrames } from './signals';

export type Outcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string };

export function runModule<T>(fn: () => T): Outcome<T> {
  try {
    return { status: 'ok', value: fn() };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export interface ServeReport {
  appVersion: string;
  paramsVersion: string;
  createdAt: string;
  video: { fileName: string; width: number; height: number; frames: number; durationMs: number };
  model: PoseTrack['model'];
  sampling: PoseTrack['sampling'];
  /** Which clip of the video this report covers. */
  clip: { index: number; count: number; startMs: number; endMs: number; cameraMoving: boolean; driftMedian: number | null };
  /** Arm (by the pose model's left/right labels) analyzed as the hitting arm. */
  hand: Side;
  /** 'detected' = picked from the motion (racket arm is much faster); 'selected' = the user's choice. */
  handSource: 'detected' | 'selected';
  /** Left/right label repairs (see pose/consistency.ts). */
  labelRepairs: { swappedFrames: number; mergedFrames: number };
  /** Footage quality and filming tips for this clip. */
  footage: FootageQuality;
  /** Frame the user marked as contact, or null if contact was detected automatically. */
  contactOverride: number | null;
  calibration: Outcome<Calibration>;
  phases: Outcome<PhaseResult>;
  footFault: Outcome<FootFaultResult>;
  motion: Outcome<MotionResult>;
}

export function tryCalibrate(clicks: CalibrationClick[]): Outcome<Calibration> {
  if (clicks.length === 0) return { status: 'skipped', message: 'Court calibration was skipped.' };
  return runModule(() => calibrate(clicks));
}

export interface AnalysisContext {
  clicks: CalibrationClick[];
  /** Time of the frame the court was marked on, or null if not marked. */
  calibrationTimeMs: number | null;
  /** The hitting hand the user chose. */
  hand: Side;
  fileName: string;
  /** Small stills kept during analysis, for automatic court detection. */
  stills?: Still[];
}

export interface ClipAnalysis {
  segment: Segment;
  /** The clip's frames after left/right repair (real timestamps). */
  track: PoseTrack;
  report: ServeReport;
}

/** Court calibration for one clip: only valid if it was marked on this clip and the camera holds still. */
/** Where the player's feet are near the start of a clip (lower ankle, median over ~0.5 s), in video px. */
function feetNearStart(track: PoseTrack): { x: number; y: number } | null {
  const t0 = track.frames[0]?.timeMs ?? 0;
  const pts = track.frames
    .filter((f) => f.timeMs - t0 <= 500 && f.pose)
    .map((f) => {
      const p = f.pose!;
      const low = p.leftAnkle.y >= p.rightAnkle.y ? p.leftAnkle : p.rightAnkle;
      return low.visibility >= 0.5 ? { x: (p.leftAnkle.x + p.rightAnkle.x) / 2, y: low.y } : null;
    })
    .filter((p): p is { x: number; y: number } => !!p);
  if (!pts.length) return null;
  const mid = (v: number[]) => [...v].sort((a2, b2) => a2 - b2)[v.length >> 1]!;
  return { x: mid(pts.map((p) => p.x)), y: mid(pts.map((p) => p.y)) };
}

/** Find the court automatically in this clip's stills (median of several when there are enough). */
function autoCalibration(clipTrack: PoseTrack, stills: Still[], t0: number, t1: number): Outcome<Calibration> {
  const mine = stills.filter((s) => s.timeMs >= t0 - 1 && s.timeMs <= t1 + 1);
  if (!mine.length) return { status: 'skipped', message: "The court couldn't be found automatically. Mark it by hand." };
  const scale = mine[0]!.scale;
  const image = mine.length >= 3 ? medianImage(mine.slice(0, 12).map((s) => s.image)) : mine[0]!.image;
  const feet = feetNearStart(clipTrack);
  const found = detectCourt(image, { feet: feet ? { x: feet.x * scale, y: feet.y * scale } : null, view: 'behind' });
  if (!found) return { status: 'skipped', message: "The court lines couldn't be found automatically. Mark the court by hand." };
  const clicks = found.landmarks.map((l) => ({ id: l.id, image: { x: l.image.x / scale, y: l.image.y / scale } }));
  const cal = tryCalibrate(clicks);
  if (cal.status === 'ok') {
    cal.value.source = 'auto';
    cal.value.autoHitRatio = found.hitRatio;
  }
  return cal;
}

function clipCalibration(raw: PoseTrack, clipTrack: PoseTrack, seg: Segment, ctx: AnalysisContext): Outcome<Calibration> {
  const t0 = raw.frames[seg.start]!.timeMs, t1 = raw.frames[seg.end - 1]!.timeMs;
  if (seg.cameraMoving) {
    return {
      status: 'skipped',
      message: 'The camera pans or zooms in this clip (common in SwingVision and similar exports), so positions on the court can\'t be measured. Film with a fixed phone for foot-fault and court checks.',
    };
  }
  // A court marked by hand on this clip wins; otherwise find it automatically.
  const markedHere = ctx.clicks.length > 0 && (ctx.calibrationTimeMs === null || (ctx.calibrationTimeMs >= t0 - 1 && ctx.calibrationTimeMs <= t1 + 1));
  if (markedHere) {
    const cal = tryCalibrate(ctx.clicks);
    if (cal.status === 'ok') cal.value.source = 'manual';
    return cal;
  }
  if (ctx.stills?.length) return autoCalibration(clipTrack, ctx.stills, t0, t1);
  return { status: 'skipped', message: 'Court calibration was skipped.' };
}

/** Analyze one clip of the video. */
export function analyzeClip(raw: PoseTrack, segments: Segment[], index: number, ctx: AnalysisContext, contactOverride: number | null = null): ClipAnalysis {
  const seg = segments[index]!;
  const repair = fixLeftRightSwaps(sliceTrack(raw, seg));
  const track = repair.track;
  const detected = detectHittingSide(track, smoothingFrames(track, PARAMS.smoothingWindowMs), PARAMS.segments.hittingArmSpeedRatio);
  const report = analyzeServe(track, clipCalibration(raw, track, seg, ctx), detected?.side ?? ctx.hand, ctx.fileName, contactOverride, {
    clip: {
      index, count: segments.length, startMs: track.frames[0]?.timeMs ?? 0, endMs: track.frames[track.frames.length - 1]?.timeMs ?? 0,
      cameraMoving: seg.cameraMoving, driftMedian: seg.driftMedian,
    },
    handSource: detected ? 'detected' : 'selected',
    labelRepairs: { swappedFrames: repair.swappedFrames.length, mergedFrames: repair.mergedFrames.length },
  });
  report.footage = assessFootage(track, {
    hand: report.hand,
    cameraMoving: seg.cameraMoving,
    contactFrame: report.phases.status === 'ok' ? report.phases.value.events.contact : null,
    p: PARAMS.footage,
  });
  if (report.motion.status === 'ok' && report.footage.issues.some((i) => DETAIL_ISSUES.includes(i))) {
    report.motion.value.confidence = 'rough';
  }
  return { segment: seg, track, report };
}

/** Split the video at hard cuts and analyze every clip. */
export function analyzeVideo(raw: PoseTrack, ctx: AnalysisContext): { segments: Segment[]; clips: ClipAnalysis[] } {
  const segments = findSegments(raw, PARAMS.segments);
  return { segments, clips: segments.map((_, i) => analyzeClip(raw, segments, i, ctx)) };
}

export function analyzeServe(
  track: PoseTrack,
  calibration: Outcome<Calibration>,
  hand: Side,
  fileName: string,
  contactOverride: number | null,
  info: Pick<ServeReport, 'clip' | 'handSource' | 'labelRepairs'> & Partial<Pick<ServeReport, 'footage'>>,
): ServeReport {
  const smoothingWindow = smoothingFrames(track, PARAMS.smoothingWindowMs);
  const phases = runModule(() =>
    detectPhases({ track, hand, params: PARAMS.phases, smoothingWindow, contactFrame: contactOverride }),
  );

  let footFault: Outcome<FootFaultResult>;
  const residual = calibration.status === 'ok' ? calibration.value.residualCm : null;
  if (calibration.status !== 'ok') {
    footFault = { status: 'skipped', message: calibration.status === 'skipped' ? calibration.message : 'Needs the court to be marked.' };
  } else if (residual !== null && residual > PARAMS.calibration.maxResidualCm) {
    footFault = {
      status: 'skipped',
      message: `The court marking doesn't fit well (fit error ${residual.toFixed(0)} cm, limit ${PARAMS.calibration.maxResidualCm} cm), so no call is made. Re-mark the court.`,
    };
  } else if (phases.status !== 'ok') {
    footFault = { status: 'skipped', message: 'Needs serve phases (to know when contact happened).' };
  } else {
    const { start, contact } = phases.value.events;
    footFault = runModule(() =>
      judgeFootFault({
        track,
        imageToCourt: calibration.value.imageToCourt,
        startFrame: start ?? 0,
        contactFrame: contact,
        params: PARAMS.footFault,
        smoothingWindow,
      }),
    );
  }

  // Court geometry is only used for the motion checks if the marking passed the fit check.
  const trustedCourt =
    calibration.status === 'ok' && (residual === null || residual <= PARAMS.calibration.maxResidualCm)
      ? calibration.value.imageToCourt
      : null;
  const motion: Outcome<MotionResult> =
    phases.status !== 'ok'
      ? { status: 'skipped', message: 'Needs the serve phases.' }
      : runModule(() =>
          rateServe({
            track,
            phases: phases.value,
            hand,
            footFault: footFault.status === 'ok' ? footFault.value : null,
            imageToCourt: trustedCourt,
            params: PARAMS.motion,
            phaseParams: PARAMS.phases,
            smoothingWindow,
          }),
        );

  const last = track.frames[track.frames.length - 1];
  return {
    appVersion: APP_VERSION,
    paramsVersion: PARAMS.version,
    createdAt: new Date().toISOString(),
    video: {
      fileName,
      width: track.videoWidth,
      height: track.videoHeight,
      frames: track.frames.length,
      durationMs: last ? last.timeMs : 0,
    },
    model: track.model,
    sampling: track.sampling,
    footage: { playerHeightPx: null, fps: 0, width: track.videoWidth, height: track.videoHeight, hittingArmVisible: null, tips: [], issues: [] },
    ...info,
    hand,
    contactOverride,
    calibration,
    phases,
    footFault,
    motion,
  };
}
