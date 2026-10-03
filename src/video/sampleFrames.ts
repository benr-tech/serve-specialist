import type { PoseBackend, PoseFrame, PoseTrack } from '../pose/types';
import { SceneMeter } from './sceneChange';

export interface SampleOptions {
  onProgress?: (fraction: number) => void;
  /** Called after each frame is analyzed, with the video showing that frame. */
  onFrame?: (frame: PoseFrame, image: CanvasImageSource) => void;
  signal?: AbortSignal;
}

/** Wait this long after 'seeked' for a frame callback before deciding no new frame was shown. */
const NO_NEW_FRAME_MS = 80;

/**
 * Seek to `t` (s). Resolves with the presentation time (s) of the frame now shown,
 * or null if the browser presented no new frame (the seek landed on the frame we already had).
 */
function seekTo(video: HTMLVideoElement, t: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve(v);
    };
    const onSeeked = () => setTimeout(() => finish(null), NO_NEW_FRAME_MS);
    video.addEventListener('seeked', onSeeked);
    video.requestVideoFrameCallback((_now, meta) => finish(meta.mediaTime));
    video.currentTime = t;
  });
}

/**
 * FALLBACK ONLY, used when WebCodecs can't decode the file (see decodeFrames.ts).
 * Browsers don't reliably report which frame a seek landed on, so this can skip frames.
 *
 * Runs the pose backend once on every frame of `video`, recording each frame's real
 * presentation time.
 *
 * We step through the video by seeking. The frame interval is learned as we go
 * (smallest gap seen between two frames) so we land on each frame once even when
 * the phone recorded at a variable frame rate.
 */
export async function samplePoseTrack(
  video: HTMLVideoElement,
  backend: PoseBackend,
  { onProgress, onFrame, signal }: SampleOptions = {},
): Promise<PoseTrack> {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    throw new Error('This browser does not support requestVideoFrameCallback. Use a recent Chrome, Edge, or Safari.');
  }
  video.pause();
  const frames: PoseFrame[] = [];
  const meter = new SceneMeter();
  const duration = video.duration;
  let interval = 1 / 60; // first guess; refined below
  let lastTime = -Infinity;
  let target = 0;

  while (target < duration) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    let mediaTime = await seekTo(video, target);
    // The very first frame may already be on screen, so no callback fires.
    if (mediaTime === null && frames.length === 0) mediaTime = video.currentTime;

    if (mediaTime === null || mediaTime <= lastTime) {
      target += interval / 2; // still on the previous frame: nudge forward
      continue;
    }
    const gap = mediaTime - lastTime;
    if (frames.length === 1) interval = gap;
    else if (frames.length > 1) interval = Math.min(interval, gap);
    lastTime = mediaTime;
    const timeMs = mediaTime * 1000;
    const det = backend.detect(video, video.videoWidth, video.videoHeight, timeMs);
    const scene = meter.measure(video, video.videoWidth, video.videoHeight, det?.pose ?? null, timeMs);
    const frame: PoseFrame = { index: frames.length, timeMs, pose: det?.pose ?? null, world: det?.world ?? null, scene };
    frames.push(frame);
    onFrame?.(frame, video);
    onProgress?.(Math.min(1, mediaTime / duration));
    // Aim a quarter-interval into the next frame's display window.
    target = mediaTime + interval * 1.25;
  }
  onProgress?.(1);
  return {
    frames,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    model: { name: backend.name, version: backend.version },
    sampling: 'seek',
  };
}
