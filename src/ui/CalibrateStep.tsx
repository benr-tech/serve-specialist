import { ArrowRight, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { tryCalibrate } from '../analysis/analyze';
import { PARAMS } from '../analysis/params';
import type { CalibrationClick } from '../court/calibration';
import { CALIBRATION_ORDER, REQUIRED_POINTS } from '../court/court';
import { invertHomography } from '../geometry/homography';
import { clear, drawClicks, drawCourt, eventToVideoPx } from './draw';
import { CourtDiagram } from './CourtDiagram';
import { videoFrameClasses } from './videoFrame';

const LOUPE_CSS = 150;
const LOUPE_ZOOM = 4;

export type CameraView = 'behind' | 'front';

/**
 * Plain-language names for each point, phrased to finish "Click where...". Left/right are as seen
 * in the video: from behind the server that's the server's own left/right; from in front it's
 * mirrored.
 */
function where(id: string, view: CameraView): string {
  const side = (serverSide: 'left' | 'right') => {
    const s = view === 'behind' ? serverSide : serverSide === 'left' ? 'right' : 'left';
    return `${s}-hand`;
  };
  switch (id) {
    case 'baseline_singles_left': return `the server's baseline meets the ${side('left')} singles sideline`;
    case 'baseline_singles_right': return `the server's baseline meets the ${side('right')} singles sideline`;
    case 'service_singles_right': return `the service line meets the ${side('right')} singles sideline`;
    case 'service_singles_left': return `the service line meets the ${side('left')} singles sideline`;
    case 'center_mark': return "the center mark touches the server's baseline";
    default: return 'the T, where the service line meets the center line';
  }
}

export function CalibrateStep({
  videoUrl,
  onDone,
  onBack,
  startTimeMs = 0,
}: {
  videoUrl: string;
  /** Open on this moment of the video (e.g. the start of the clip being fixed). */
  startTimeMs?: number;
  /** clicks + the time (ms) of the frame they were made on. */
  onDone: (clicks: CalibrationClick[], timeMs: number | null) => void;
  onBack: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [clicks, setClicks] = useState<CalibrationClick[]>([]);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [size, setSize] = useState({ w: 1280, h: 720 });

  const next = CALIBRATION_ORDER[clicks.length] ?? null;
  const [view, setView] = useState<CameraView>('behind');
  const fit = videoFrameClasses(size.w, size.h);
  const needed = Math.max(0, REQUIRED_POINTS - clicks.length);
  const calibration = useMemo(() => (clicks.length >= REQUIRED_POINTS ? tryCalibrate(clicks) : null), [clicks]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    clear(ctx);
    if (calibration?.status === 'ok') {
      try {
        drawCourt(ctx, invertHomography(calibration.value.imageToCourt));
      } catch {
        /* the overlay is only a visual check */
      }
    }
    drawClicks(ctx, clicks);
  }, [clicks, calibration, size]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!next || !canvas.current) return;
    setClicks([...clicks, { id: next, image: eventToVideoPx(e, canvas.current) }]);
  };

  // Magnifier: shows the video around the cursor at LOUPE_ZOOMx so clicks land on the line itself.
  const loupe = useRef<HTMLCanvasElement>(null);
  const [loupeAt, setLoupeAt] = useState<{ left: number; top: number } | null>(null);
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvas.current, v = video.current, l = loupe.current;
    if (!c || !v || !l || !next) return setLoupeAt(null);
    const r = c.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const p = eventToVideoPx(e, c);
    const srcSize = (LOUPE_CSS / LOUPE_ZOOM) * (c.width / r.width); // video px shown in the loupe
    const ctx = l.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, l.width, l.height);
    ctx.drawImage(v, p.x - srcSize / 2, p.y - srcSize / 2, srcSize, srcSize, 0, 0, l.width, l.height);
    ctx.drawImage(c, p.x - srcSize / 2, p.y - srcSize / 2, srcSize, srcSize, 0, 0, l.width, l.height); // existing marks
    const m = l.width / 2;
    ctx.strokeStyle = '#d5ee3f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m, m - 18); ctx.lineTo(m, m - 5); ctx.moveTo(m, m + 5); ctx.lineTo(m, m + 18);
    ctx.moveTo(m - 18, m); ctx.lineTo(m - 5, m); ctx.moveTo(m + 5, m); ctx.lineTo(m + 18, m);
    ctx.stroke();
    // Sit above-left of the cursor so it never covers the point being aimed at; flip near edges.
    const left = cx - LOUPE_CSS - 24 < 0 ? cx + 24 : cx - LOUPE_CSS - 24;
    const top = cy - LOUPE_CSS - 24 < 0 ? cy + 24 : cy - LOUPE_CSS - 24;
    setLoupeAt({ left, top });
  };

  return (
    <section className="grid gap-x-14 gap-y-10 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <div className={fit.box}>
          <video
            ref={video}
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            className={fit.video}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(v.duration);
              setSize({ w: v.videoWidth, h: v.videoHeight });
              if (startTimeMs > 0) {
                v.currentTime = startTimeMs / 1000 + 0.05;
                setTime(v.currentTime);
              }
            }}
          />
          <canvas
            ref={canvas}
            width={size.w}
            height={size.h}
            onClick={onClick}
            onMouseMove={onMove}
            onMouseLeave={() => setLoupeAt(null)}
            className={`absolute inset-0 size-full ${next ? 'cursor-crosshair' : ''}`}
          />
          <canvas
            ref={loupe}
            width={LOUPE_CSS * 2}
            height={LOUPE_CSS * 2}
            aria-hidden
            className={`pointer-events-none absolute rounded-full shadow-lift ring-2 ring-white/80 transition-opacity duration-200 ${loupeAt ? 'opacity-100' : 'opacity-0'}`}
            style={{ width: LOUPE_CSS, height: LOUPE_CSS, left: loupeAt?.left ?? 0, top: loupeAt?.top ?? 0 }}
          />
        </div>
        <div className="mt-6 flex items-center gap-5">
          <span className="shrink-0 text-sm text-muted-foreground">Find a frame where the lines are clear</span>
          <Slider
            min={0}
            max={duration || 1}
            step={0.01}
            value={[time]}
            onValueChange={([t]) => {
              setTime(t!);
              if (video.current) video.current.currentTime = t!;
            }}
            aria-label="Choose frame"
          />
          <span className="tabular w-14 shrink-0 text-right text-sm text-muted-foreground">{time.toFixed(2)} s</span>
        </div>
      </div>

      <aside className="lg:col-span-4 lg:pt-2">
        <p className="eyebrow">Mark the court</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Camera is</span>
          <div className="inline-flex rounded-full bg-secondary p-0.5 font-semibold" role="radiogroup" aria-label="Camera position">
            {(['behind', 'front'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 transition-all duration-300 ease-soft ${view === v ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {v === 'behind' ? 'Behind the server' : 'In front'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="display text-6xl leading-none">{next ? clicks.length + 1 : '✓'}</span>
          {next && <span className="display text-3xl text-muted-foreground">/ {clicks.length < REQUIRED_POINTS ? REQUIRED_POINTS : CALIBRATION_ORDER.length}</span>}
        </div>
        <p className="mt-4 text-lg leading-snug">
          {next ? (
            <>
              Click where <strong className="font-semibold">{where(next, view)}</strong>.
              {clicks.length >= REQUIRED_POINTS && <span className="text-muted-foreground"> Optional. It adds an accuracy check.</span>}
            </>
          ) : (
            'All six points marked.'
          )}
        </p>

        <div className="mt-7 max-w-[15rem]">
          <CourtDiagram active={next} done={clicks.map((c) => c.id)} view={view} />
        </div>

        <div className="mt-7 min-h-[3rem] text-sm">
          {calibration?.status === 'ok' &&
            (calibration.value.residualCm !== null && calibration.value.residualCm > PARAMS.calibration.maxResidualCm ? (
              <p className="border-l-2 border-clay pl-3 text-muted-foreground">
                These points don't agree with each other (fit error{' '}
                <span className="tabular font-semibold text-foreground">{calibration.value.residualCm.toFixed(0)} cm</span>). One is
                probably off. Undo the last points and re-click, or there will be no foot-fault call.
              </p>
            ) : (
              <p className="border-l-2 border-good pl-3 text-muted-foreground">
                The yellow lines should sit on top of the painted lines. If they don't, undo and re-click.
                {calibration.value.residualCm !== null && (
                  <> Fit error <span className="tabular font-semibold text-foreground">{calibration.value.residualCm.toFixed(1)} cm</span>.</>
                )}
              </p>
            ))}
          {calibration?.status === 'error' && (
            <p className="border-l-2 border-clay pl-3 text-muted-foreground">{calibration.message} Undo and try again.</p>
          )}
          {!calibration && clicks.length === 0 && (
            <p className="text-muted-foreground">Start with the highlighted point, then work around the box.</p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setClicks(clicks.slice(0, -1))} disabled={clicks.length === 0}>
            <Undo2 /> Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setClicks([])} disabled={clicks.length === 0}>
            Start over
          </Button>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-t pt-6">
          <Button size="lg" disabled={needed > 0} onClick={() => onDone(clicks, (video.current?.currentTime ?? time) * 1000)}>
            {needed > 0 ? `${needed} more point${needed === 1 ? '' : 's'}` : 'Analyze serve'} {needed === 0 && <ArrowRight />}
          </Button>
          <Button variant="link" size="sm" onClick={() => onDone([], null)}>Skip, no foot-fault check</Button>
          <Button variant="link" size="sm" onClick={onBack} className="text-muted-foreground">Back</Button>
        </div>
      </aside>
    </section>
  );
}
