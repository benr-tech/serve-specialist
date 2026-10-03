/**
 * How good is the footage for analysis? Turns the things that most limit accuracy (player too
 * small, low resolution, 30 fps, moving camera, racket arm hidden) into concrete filming tips.
 */
import type { PoseTrack, Side } from '../pose/types';
import type { FootageParams } from './params';
import { frameTimes } from './signals';

export interface FootageQuality {
  /** Median nose-to-lower-ankle height of the player, in video pixels. */
  playerHeightPx: number | null;
  fps: number;
  width: number;
  height: number;
  /** Share of frames around the swing where the hitting wrist is clearly visible (0–1). */
  hittingArmVisible: number | null;
  /** One short, actionable tip per problem; empty when the footage is good. */
  tips: string[];
  /** Problems found, as codes (same order as tips). */
  issues: FootageIssue[];
}

export type FootageIssue = 'small' | 'low_res' | 'low_fps' | 'camera_moving' | 'arm_hidden';
/** Issues that make the motion measurements themselves less precise. */
export const DETAIL_ISSUES: FootageIssue[] = ['small', 'low_res', 'low_fps', 'arm_hidden'];

export function assessFootage(
  track: PoseTrack,
  opts: { hand: Side; cameraMoving: boolean; contactFrame: number | null; p: FootageParams },
): FootageQuality {
  const { hand, cameraMoving, contactFrame, p } = opts;
  const times = frameTimes(track);
  const fps = times.length > 1 ? (times.length - 1) / ((times[times.length - 1]! - times[0]!) / 1000) : 0;

  const heights = track.frames
    .map((f) => f.pose)
    .filter((q): q is NonNullable<typeof q> => !!q && q.nose.visibility >= 0.5)
    .map((q) => Math.max(q.leftAnkle.y, q.rightAnkle.y) - q.nose.y)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const playerHeightPx = heights.length ? heights[heights.length >> 1]! : null;

  let hittingArmVisible: number | null = null;
  if (contactFrame !== null) {
    const t = times[contactFrame]!;
    const near = track.frames.filter((f) => Math.abs(f.timeMs - t) <= p.armWindowMs);
    if (near.length) hittingArmVisible = near.filter((f) => (f.pose?.[`${hand}Wrist`].visibility ?? 0) >= 0.5).length / near.length;
  }

  const w = track.videoWidth, h = track.videoHeight;
  const tips: string[] = [];
  const issues: FootageIssue[] = [];
  if (playerHeightPx !== null && playerHeightPx < p.minPlayerHeightFraction * h) {
    issues.push('small');
    tips.push(
      `You're small in the frame (about ${Math.round(playerHeightPx)} px tall out of ${h}). Move the phone closer or zoom in so you fill at least half the height of the picture.`,
    );
  }
  if (Math.min(w, h) < p.minShortSidePx) {
    issues.push('low_res');
    tips.push(`The video is low resolution (${w}×${h}), usually because it was sent through a messaging app. Use the original file: AirDrop it, or save it straight from the camera roll.`);
  }
  if (fps > 0 && fps < p.minFps) {
    issues.push('low_fps');
    tips.push(`Filmed at ${Math.round(fps)} fps, so the racket arm blurs around contact. Switch to 60 fps (iPhone: Settings → Camera → Record Video).`);
  }
  if (cameraMoving) {
    issues.push('camera_moving');
    tips.push('The camera moved (handheld, panning or auto-zoom). Prop the phone on the fence, a bag or a tripod so it stays still. That also unlocks the foot-fault and court checks.');
  }
  if (hittingArmVisible !== null && hittingArmVisible < p.minArmVisibleShare) {
    issues.push('arm_hidden');
    tips.push("Your hitting arm was hard to see around contact. Pick a camera spot where your body doesn't hide it (diagonal views from behind or in front work best).");
  }
  return { playerHeightPx, fps, width: w, height: h, hittingArmVisible, tips, issues };
}
