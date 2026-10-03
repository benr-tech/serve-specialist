/**
 * Frame-exact decoding with WebCodecs.
 *
 * mp4box reads the MP4/MOV container and hands us every compressed frame with its exact
 * timestamp; the browser's hardware VideoDecoder turns each one into an image. Every frame is
 * seen exactly once, with the timestamp the phone wrote into the file, no seeking.
 */
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample, type Track } from 'mp4box';
import type { PoseBackend, PoseFrame, PoseTrack } from '../pose/types';
import { SceneMeter } from './sceneChange';

export interface DecodeOptions {
  onProgress?: (fraction: number) => void;
  /** Called after each frame is analyzed, with the decoded image (for a live preview). */
  onFrame?: (frame: PoseFrame, image: CanvasImageSource) => void;
  signal?: AbortSignal;
}

interface Demuxed {
  track: Track;
  samples: Sample[];
  config: VideoDecoderConfig;
  /** Clockwise rotation the player applies when displaying (from the track matrix). */
  rotation: 0 | 90 | 180 | 270;
  /** Converts a sample's composition time to presentation seconds, matching <video>.currentTime. */
  toSeconds: (cts: number) => number;
  /** Presentation start (s); samples before it are decoder pre-roll and not shown. */
  startS: number;
}

async function demux(file: File): Promise<Demuxed> {
  const mp4 = createFile();
  const samples: Sample[] = [];
  let info: { track: Track } | null = null;
  let error: string | null = null;
  mp4.onError = (_module: string, message: string) => { error = message; };
  mp4.onReady = (movie) => {
    const track = movie.videoTracks[0];
    if (!track) { error = 'No video track found in this file.'; return; }
    info = { track };
    mp4.setExtractionOptions(track.id, null, { nbSamples: 100_000 });
    mp4.start();
  };
  mp4.onSamples = (_id, _user, s) => { samples.push(...s); };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await file.arrayBuffer(), 0));
  mp4.flush();
  // Files passed through messaging apps often carry a few stray bytes after the last box. That
  // makes the parser complain at the very end, but the video data is fine, so only fail if
  // nothing usable came out.
  if (!info || samples.length === 0) throw new Error(error ?? 'Could not read this video file (not MP4/MOV?).');
  const { track } = info as { track: Track };

  // Codec-specific setup bytes the decoder needs (avcC for H.264, hvcC for HEVC, ...).
  let description: Uint8Array | undefined;
  for (const entry of mp4.getTrackById(track.id).mdia.minf.stbl.stsd.entries) {
    const e = entry as unknown as Record<string, { write(s: DataStream): void } | undefined>;
    const box = e.avcC ?? e.hvcC ?? e.vpcC ?? e.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      description = new Uint8Array(stream.buffer, 8); // skip the box header
      break;
    }
  }

  // Rotation: phones store "display this rotated" in the track matrix instead of rotating pixels.
  const m = track.matrix as unknown as ArrayLike<number>;
  const deg = ((Math.round((Math.atan2(m[1]!, m[0]!) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;

  // Edit list: an empty edit delays the start; a media edit says which media time is "time 0".
  let delayS = 0;
  let mediaStart = 0;
  for (const edit of (track.edits ?? []) as unknown as { media_time: number; segment_duration: number }[]) {
    if (edit.media_time === -1) delayS += edit.segment_duration / track.movie_timescale;
    else { mediaStart = edit.media_time; break; }
  }

  return {
    track,
    samples,
    config: {
      codec: track.codec.startsWith('vp08') ? 'vp8' : track.codec,
      codedWidth: track.video?.width ?? track.track_width,
      codedHeight: track.video?.height ?? track.track_height,
      description,
    },
    rotation: deg as Demuxed['rotation'],
    toSeconds: (cts) => delayS + (cts - mediaStart) / track.timescale,
    startS: delayS,
  };
}

/** True if this browser can decode the file frame-exactly. False -> use the seek-based fallback. */
export async function canDecode(file: File): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    const { config } = await demux(file);
    return (await VideoDecoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

export async function decodePoseTrack(file: File, backend: PoseBackend, { onProgress, onFrame, signal }: DecodeOptions = {}): Promise<PoseTrack> {
  const d = await demux(file);
  const w = d.config.codedWidth!, h = d.config.codedHeight!;
  const sideways = d.rotation === 90 || d.rotation === 270;
  const canvas = new OffscreenCanvas(sideways ? h : w, sideways ? w : h);
  const ctx = canvas.getContext('2d')!;

  const frames: PoseFrame[] = [];
  const meter = new SceneMeter();
  const total = d.samples.length;
  let lastMs = -Infinity;
  let failure: Error | null = null;

  const decoder = new VideoDecoder({
    output: (vf) => {
      try {
        const timeMs = vf.timestamp / 1000; // us -> ms (we set these from the container below)
        if (timeMs < d.startS * 1000 || timeMs <= lastMs) return; // pre-roll or duplicate
        lastMs = timeMs;
        // Draw upright, so keypoints match what the <video> element displays.
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((d.rotation * Math.PI) / 180);
        ctx.drawImage(vf, -vf.displayWidth / 2, -vf.displayHeight / 2, vf.displayWidth, vf.displayHeight);
        ctx.restore();
        const det = backend.detect(canvas, canvas.width, canvas.height, timeMs);
        const scene = meter.measure(canvas, canvas.width, canvas.height, det?.pose ?? null, timeMs);
        const frame: PoseFrame = { index: frames.length, timeMs, pose: det?.pose ?? null, world: det?.world ?? null, scene };
        frames.push(frame);
        onFrame?.(frame, canvas);
        onProgress?.(frames.length / total);
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      } finally {
        vf.close();
      }
    },
    error: (e) => { failure = e; },
  });
  decoder.configure(d.config);

  for (const s of d.samples) {
    if (signal?.aborted) { decoder.close(); throw new DOMException('Analysis cancelled', 'AbortError'); }
    if (failure) break;
    // Back-pressure: don't queue the whole video at once.
    while (decoder.decodeQueueSize > 4) await new Promise((r) => decoder.addEventListener('dequeue', r, { once: true }));
    decoder.decode(new EncodedVideoChunk({
      type: s.is_sync ? 'key' : 'delta',
      timestamp: Math.round(d.toSeconds(s.cts) * 1e6),
      duration: Math.round((s.duration / s.timescale) * 1e6),
      data: s.data!,
    }));
  }
  if (!failure) await decoder.flush();
  decoder.close();
  if (failure) throw failure;
  onProgress?.(1);

  return {
    frames,
    videoWidth: canvas.width,
    videoHeight: canvas.height,
    model: { name: backend.name, version: backend.version },
    sampling: 'webcodecs',
  };
}
