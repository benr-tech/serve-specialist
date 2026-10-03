import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MediaPipeBackend } from '../pose/mediapipe';
import type { PoseFrame, PoseTrack } from '../pose/types';
import { canDecode, decodePoseTrack } from '../video/decodeFrames';
import { samplePoseTrack } from '../video/sampleFrames';
import { StillCollector, type Still } from '../video/stills';
import { clear, drawSkeleton } from './draw';
import { videoFrameClasses } from './videoFrame';

export function AnalyzeStep({
  file,
  videoUrl,
  onDone,
  onCancel,
}: {
  file: File;
  videoUrl: string;
  /** The pose track, plus a few small stills for automatic court detection. */
  onDone: (track: PoseTrack, stills: Still[]) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<'loading' | 'running' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const startedAt = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    const backend = new MediaPipeBackend('heavy');
    const v = video.current!;
    const ready = new Promise<void>((res) => {
      if (v.readyState >= 1) res();
      else v.addEventListener('loadedmetadata', () => res(), { once: true });
    });
    (async () => {
      try {
        const [exact] = await Promise.all([canDecode(file), backend.init(), ready]);
        if (abort.signal.aborted) return;
        setSize({ w: v.videoWidth, h: v.videoHeight });
        setStage('running');
        startedAt.current = performance.now();
        const stills = new StillCollector();
        const preview = (f: PoseFrame, image?: CanvasImageSource) => {
          if (image) {
            const iw = image instanceof HTMLVideoElement ? image.videoWidth : (image as { width: number }).width;
            const ih = image instanceof HTMLVideoElement ? image.videoHeight : (image as { height: number }).height;
            stills.offer(image, iw, ih, f.timeMs);
          }
          const ctx = canvas.current?.getContext('2d');
          if (!ctx) return;
          clear(ctx);
          if (image) ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
          if (f.pose) drawSkeleton(ctx, f.pose);
        };
        const opts = { signal: abort.signal, onProgress: setProgress, onFrame: preview };
        const track = exact ? await decodePoseTrack(file, backend, opts) : await samplePoseTrack(v, backend, opts);
        onDone(track, stills.stills);
      } catch (e) {
        if (abort.signal.aborted) return;
        setStage('error');
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        backend.close();
      }
    })();
    return () => abort.abort();
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsed = (performance.now() - startedAt.current) / 1000;
  const eta = progress > 0.05 ? Math.max(0, elapsed / progress - elapsed) : null;
  const pct = Math.round(progress * 100);
  const fit = videoFrameClasses(size.w, size.h);

  return (
    <section className="mx-auto max-w-5xl">
      <div className={fit.box}>
        <video ref={video} src={videoUrl} muted playsInline preload="auto" className={fit.video} />
        <canvas ref={canvas} width={size.w} height={size.h} className="absolute inset-0 size-full" />
      </div>

      <div className="relative z-10 mx-4 -mt-14 rounded-2xl bg-card p-7 shadow-lift sm:mx-10 sm:ml-auto sm:w-[26rem] sm:p-8">
        {stage === 'error' ? (
          <>
            <p className="display text-3xl">Couldn't read this video</p>
            <p className="mt-3 text-sm text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <span className="display tabular text-6xl">{stage === 'loading' ? '–' : `${pct}%`}</span>
              {eta !== null && stage === 'running' && (
                <span className="tabular text-sm text-muted-foreground">about {Math.ceil(eta)} s left</span>
              )}
            </div>
            <Progress value={stage === 'loading' ? 0 : pct} className="mt-5" />
            <p className="mt-4 text-sm text-muted-foreground">
              {stage === 'loading' ? 'Loading the pose model…' : 'Tracking the body, one frame at a time.'}
            </p>
          </>
        )}
        <Button variant="link" size="sm" onClick={onCancel} className="mt-5 text-muted-foreground">
          {stage === 'error' ? 'Try another video' : 'Cancel'}
        </Button>
      </div>
    </section>
  );
}
