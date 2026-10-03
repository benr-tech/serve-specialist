/**
 * Left/right label repair.
 *
 * Pose models sometimes swap left and right labels for a stretch of frames, especially when the
 * player is filmed from behind. Often only the upper body (shoulders, elbows, wrists) swaps while
 * the legs don't, and the swap passes through a "merged" frame where both arms sit almost on top
 * of each other.
 *
 * Body parts don't teleport, so for the upper and lower body separately we compare each frame with
 * the last frame where that half was clearly separated left-vs-right, and trade the labels back if
 * the swapped version lines up much better. Frames where an arm pair has collapsed onto itself are
 * marked low-visibility, so the analysis skips them and smoothing bridges the gap.
 */
import type { Keypoint, KeypointName, Pose, PoseFrame, PoseTrack, WorldPose } from './types';

type Pair = [KeypointName, KeypointName];
const UPPER: Pair[] = [
  ['leftShoulder', 'rightShoulder'], ['leftElbow', 'rightElbow'], ['leftWrist', 'rightWrist'],
  ['leftIndex', 'rightIndex'], ['leftPinky', 'rightPinky'],
];
const LOWER: Pair[] = [
  ['leftHip', 'rightHip'], ['leftKnee', 'rightKnee'], ['leftAnkle', 'rightAnkle'], ['leftHeel', 'rightHeel'], ['leftToe', 'rightToe'],
];
/** Pairs used to judge whether a half is clearly separated (hips and shoulders often overlap side-on). */
const UPPER_SEP: Pair[] = [['leftElbow', 'rightElbow'], ['leftWrist', 'rightWrist']];
const LOWER_SEP: Pair[] = [['leftKnee', 'rightKnee'], ['leftAnkle', 'rightAnkle']];

/** Swap only if it explains the motion this much better (cost ratio). */
const SWAP_RATIO = 0.6;
/** A half counts as clearly separated if its left/right points are this far apart (torso lengths). */
const MIN_SEPARATION = 0.35;
/** Arms closer than this (torso lengths) in a frame between clearly separated frames = a merged, unreliable frame. */
const MERGED = 0.12;
const MIN_VIS = 0.3;

const visible = (k: Keypoint | undefined): k is Keypoint => !!k && k.visibility >= MIN_VIS;

function torso(p: Pose): number | null {
  const s = [p.leftShoulder, p.rightShoulder, p.leftHip, p.rightHip];
  if (!s.every(visible)) return null;
  const sx = (s[0]!.x + s[1]!.x) / 2, sy = (s[0]!.y + s[1]!.y) / 2;
  const hx = (s[2]!.x + s[3]!.x) / 2, hy = (s[2]!.y + s[3]!.y) / 2;
  return Math.hypot(sx - hx, sy - hy) || null;
}

/** Mean left-right distance over the pairs that are visible, or null if none are. */
function separation(p: Pose, pairs: Pair[]): number | null {
  let sum = 0, n = 0;
  for (const [l, r] of pairs) {
    if (visible(p[l]) && visible(p[r])) {
      sum += Math.hypot(p[l].x - p[r].x, p[l].y - p[r].y);
      n++;
    }
  }
  return n ? sum / n : null;
}

/** Distance from `cur` to `ref` over the pairs, optionally with left/right traded. */
function cost(cur: Pose, ref: Pose, pairs: Pair[], swap: boolean): number {
  let total = 0;
  for (const [l, r] of pairs) {
    for (const [a, b] of [[l, swap ? r : l], [r, swap ? l : r]] as const) {
      if (visible(cur[a]) && visible(ref[b])) total += Math.hypot(cur[a].x - ref[b].x, cur[a].y - ref[b].y);
    }
  }
  return total;
}

function swapPairs<T extends Pose | WorldPose>(p: T, pairs: Pair[]): T {
  const out = { ...p } as Record<KeypointName, unknown>;
  for (const [l, r] of pairs) {
    out[l] = p[r];
    out[r] = p[l];
  }
  return out as T;
}

function dim<T extends Pose | WorldPose>(p: T, pairs: Pair[]): T {
  const out = { ...p } as Record<KeypointName, Keypoint>;
  for (const pair of pairs) for (const k of pair) if (p[k]) out[k] = { ...p[k], visibility: Math.min(p[k].visibility, 0.2) };
  return out as T;
}

export interface SwapRepair {
  track: PoseTrack;
  /** Frames where upper- or lower-body labels were traded back. */
  swappedFrames: number[];
  /** Frames where the arms had merged and were marked unreliable. */
  mergedFrames: number[];
}

export function fixLeftRightSwaps(track: PoseTrack): SwapRepair {
  const frames: PoseFrame[] = [];
  const swappedFrames: number[] = [];
  const mergedFrames: number[] = [];
  const ref: { upper: Pose | null; lower: Pose | null } = { upper: null, lower: null };

  for (const f of track.frames) {
    if (!f.pose) {
      frames.push(f);
      continue;
    }
    let pose = f.pose;
    let world = f.world;
    const t = torso(pose);
    let changed = false;

    for (const [half, pairs, sepPairs] of [['upper', UPPER, UPPER_SEP], ['lower', LOWER, LOWER_SEP]] as const) {
      const sep = separation(pose, sepPairs);
      const r = ref[half];
      const clear = t !== null && sep !== null && sep >= MIN_SEPARATION * t;
      if (r && clear && cost(pose, r, pairs, true) < SWAP_RATIO * cost(pose, r, pairs, false)) {
        pose = swapPairs(pose, pairs);
        world = world ? swapPairs(world, pairs) : world;
        changed = true;
      }
      if (clear) ref[half] = pose;
      else if (half === 'upper' && r && t !== null && sep !== null && sep < MERGED * t) {
        pose = dim(pose, UPPER_SEP);
        world = world ? dim(world, UPPER_SEP) : world;
        mergedFrames.push(f.index);
      }
    }
    if (changed) swappedFrames.push(f.index);
    frames.push({ ...f, pose, world });
  }
  return { track: { ...track, frames }, swappedFrames, mergedFrames };
}
