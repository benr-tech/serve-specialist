import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Download, Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ClipAnalysis, Outcome, ServeReport } from '../analysis/analyze';
import type { FootFaultResult, Verdict } from '../analysis/footFault';
import { PHASE_ORDER, type PhaseName, type PhaseResult } from '../analysis/phases';
import { invertHomography } from '../geometry/homography';
import type { Mat3 } from '../geometry/types';
import type { PoseTrack } from '../pose/types';
import type { CheckId } from '../analysis/motion';
import { clear, drawAngle, drawCourt, drawFootMarker, drawSkeleton } from './draw';
import { videoFrameClasses } from './videoFrame';
import { Breakdown, FootageTips, overlayLabel, RatingCard, STATUS_STYLE } from './MotionReport';

const PHASE_LABEL: Record<PhaseName, string> = {
  start: 'Toss starts',
  trophy: 'Trophy position',
  racketDrop: 'Racket drop',
  contact: 'Contact',
  landing: 'Landing',
};

/** Marker colors for the timeline and phase list. */
export const PHASE_COLOR: Record<PhaseName, string> = {
  start: '#8a8f84',
  trophy: '#4a72b0',
  racketDrop: '#2f8c84',
  contact: '#c79a00',
  landing: '#2b7549',
};

const VERDICT: Record<Verdict, { word: string; cls: string }> = {
  fault: { word: 'Foot fault.', cls: 'text-clay' },
  legal: { word: 'Legal.', cls: 'text-good' },
  too_close: { word: 'Too close to call.', cls: 'text-amber' },
  cant_tell: { word: "Can't tell.", cls: 'text-muted-foreground' },
};

const SPEEDS = [
  { v: 0.1, label: '0.1×' },
  { v: 0.25, label: '¼×' },
  { v: 0.5, label: '½×' },
  { v: 1, label: '1×' },
];

/** Index of the frame closest to timeMs (frames are sorted by time). */
function nearestFrame(track: PoseTrack, timeMs: number): number {
  const f = track.frames;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid]!.timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(f[lo - 1]!.timeMs - timeMs) < Math.abs(f[lo]!.timeMs - timeMs)) lo--;
  return lo;
}

/**
 * Event ticks for the timeline (position in %). Labels alternate above and below the line, and a
 * label is dropped (the tick keeps a hover title) if it would collide with the previous one on its side.
 */
function timelineMarkers(events: PhaseResult['events'] | null, track: PoseTrack, t0: number, spanMs: number) {
  if (!events) return [];
  const lastPos = { above: -Infinity, below: -Infinity };
  let side: 'above' | 'below' = 'above';
  const out: { name: PhaseName; pos: number; label: 'above' | 'below' | null }[] = [];
  for (const name of PHASE_ORDER) {
    const i = events[name];
    if (i === null) continue;
    const pos = ((track.frames[i]!.timeMs - t0) / spanMs) * 100;
    const fits = pos - lastPos[side] > 11;
    if (fits) lastPos[side] = pos;
    out.push({ name, pos, label: fits ? side : null });
    side = side === 'above' ? 'below' : 'above';
  }
  return out;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export function ResultsStep({
  videoUrl,
  track,
  report,
  onRestart,
  onSetContact,
  onFixCourt,
  clips,
  selected,
  onSelectClip,
}: {
  videoUrl: string;
  track: PoseTrack;
  report: ServeReport;
  /** Open the court-marking screen to fix or add the court for this clip. */
  onFixCourt: () => void;
  /** Every clip (serve) found in the video; the selector shows when there's more than one. */
  clips: ClipAnalysis[];
  selected: number;
  onSelectClip: (index: number) => void;
  onRestart: () => void;
  /** Mark this frame as ball contact (null = go back to automatic detection). */
  onSetContact: (frame: number | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(0.5);
  /** The breakdown check currently highlighted on the video. */
  const [focus, setFocus] = useState<CheckId | null>(null);
  const focusCheck = report.motion.status === 'ok' ? (report.motion.value.checks.find((c) => c.id === focus) ?? null) : null;
  /** This clip's time range in the video (ms). */
  const t0 = track.frames[0]?.timeMs ?? 0;
  const t1 = track.frames[track.frames.length - 1]?.timeMs ?? 0;

  const courtToImage = useMemo<Mat3 | null>(() => {
    if (report.calibration.status !== 'ok') return null;
    try {
      return invertHomography(report.calibration.value.imageToCourt);
    } catch {
      return null;
    }
  }, [report]);

  const footSamples = useMemo(() => {
    const m = new Map<number, FootFaultResult['samples'][number]>();
    if (report.footFault.status === 'ok') for (const s of report.footFault.value.samples) m.set(s.frameIndex, s);
    return m;
  }, [report]);

  const draw = useCallback(
    (i: number) => {
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      clear(ctx);
      if (courtToImage) drawCourt(ctx, courtToImage);
      const shownMs = (video.current?.currentTime ?? 0) * 1000;
      const inClip = shownMs >= t0 - 40 && shownMs <= t1 + 40;
      const pose = inClip ? track.frames[i]?.pose : null;
      if (pose) drawSkeleton(ctx, pose);
      const s = footSamples.get(i);
      if (s && pose) {
        for (const side of ['left', 'right'] as const) {
          const fs = s[side];
          if (fs?.grounded) {
            const toe = pose[`${side}Toe`];
            drawFootMarker(ctx, toe.x, toe.y, fs.marginCm, fs.bandCm);
          }
        }
      }
      if (pose && focusCheck?.joints && focusCheck.value !== null) {
        const [a, b, c] = focusCheck.joints.map((j) => pose[j]);
        if (a && b && c && a.visibility >= 0.5 && b.visibility >= 0.5 && c.visibility >= 0.5) {
          drawAngle(ctx, a, b, c, overlayLabel(focusCheck), STATUS_STYLE[focusCheck.status].stroke);
        }
      }
    },
    [track, courtToImage, footSamples, focusCheck],
  );

  // Keep the overlay in sync with whatever frame the video is showing.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0;
    const tick: VideoFrameRequestCallback = (_now, meta) => {
      const i = nearestFrame(track, meta.mediaTime * 1000);
      setFrame(i);
      draw(i);
      handle = v.requestVideoFrameCallback(tick);
    };
    handle = v.requestVideoFrameCallback(tick);
    return () => v.cancelVideoFrameCallback(handle);
  }, [track, draw]);

  useEffect(() => draw(frame), [draw]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFocus(null);
    const v = video.current;
    if (!v) return;
    const go = () => seekFrame(0);
    if (v.readyState >= 1) go();
    else v.addEventListener('loadedmetadata', go, { once: true });
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate]);

  const seekFrame = useCallback(
    (i: number) => {
      const v = video.current;
      const f = track.frames[Math.max(0, Math.min(track.frames.length - 1, i))];
      if (!v || !f) return;
      v.pause();
      v.currentTime = f.timeMs / 1000 + 0.001; // land inside the frame, not on its edge
      setFrame(f.index);
      draw(f.index);
    },
    [track, draw],
  );

  const showCheck = (id: CheckId) => {
    const c = report.motion.status === 'ok' ? report.motion.value.checks.find((x) => x.id === id) : null;
    if (!c || c.frameIndex === null) return;
    setFocus(id);
    seekFrame(c.frameIndex);
    document.getElementById('player')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.key === 'ArrowRight') seekFrame(frame + 1);
      else if (e.key === 'ArrowLeft') seekFrame(frame - 1);
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ report, track }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${report.video.fileName.replace(/\.[^.]+$/, '')}.servespecialist.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const spanMs = Math.max(1, t1 - t0);
  const fit = videoFrameClasses(track.videoWidth, track.videoHeight);
  const events = report.phases.status === 'ok' ? report.phases.value.events : null;
  const currentMs = track.frames[frame]?.timeMs ?? 0;
  const isContact = events?.contact === frame;

  return (
    <>
      <section className="grid gap-x-10 gap-y-12 lg:grid-cols-12">
        {/* Video, controls, timeline */}
        <div id="player" className="min-w-0 scroll-mt-6 lg:col-span-8">
          {clips.length > 1 && (
            <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
              <p className="text-sm text-muted-foreground">
                This video has <span className="font-semibold text-foreground">{clips.length} serves</span>.
              </p>
              <div className="flex flex-wrap gap-1 rounded-full bg-secondary p-1" role="tablist" aria-label="Choose a serve">
                {clips.map((c, i) => {
                  const score = c.report.motion.status === 'ok' ? c.report.motion.value.score : null;
                  return (
                    <button
                      key={i}
                      role="tab"
                      aria-selected={i === selected}
                      onClick={() => onSelectClip(i)}
                      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-300 ease-soft ${i === selected ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Serve {i + 1}
                      <span className="tabular ml-2 font-normal opacity-70">{score ?? '–'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className={fit.box}>
            <video
              ref={video}
              src={videoUrl}
              muted
              playsInline
              preload="auto"
              className={fit.video}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <canvas ref={canvas} width={track.videoWidth} height={track.videoHeight} className="absolute inset-0 size-full" />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => seekFrame(frame - 1)} aria-label="Previous frame">
                <ChevronLeft />
              </Button>
              <Button size="icon" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause /> : <Play className="translate-x-px" />}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => seekFrame(frame + 1)} aria-label="Next frame">
                <ChevronRight />
              </Button>
            </div>
            <div className="flex rounded-full bg-secondary p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Playback speed">
              {SPEEDS.map((s) => (
                <button
                  key={s.v}
                  role="radio"
                  aria-checked={rate === s.v}
                  onClick={() => setRate(s.v)}
                  className={`rounded-full px-2.5 py-1 transition-all duration-300 ease-soft ${rate === s.v ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <Button
              variant={isContact ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => onSetContact(frame)}
              disabled={isContact && report.contactOverride === frame}
              title="Use this frame as the moment the racket hits the ball"
            >
              <Crosshair /> {isContact && report.contactOverride === frame ? 'Contact set here' : 'This frame is contact'}
            </Button>
            <span className="tabular text-sm text-muted-foreground">
              {(currentMs / 1000).toFixed(3)} s <span className="text-border">/</span> frame {frame}
            </span>
          </div>

          {/* Timeline */}
          <div
            className="group relative mt-8 h-16 cursor-pointer select-none"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seekFrame(nearestFrame(track, t0 + ((e.clientX - r.left) / r.width) * spanMs));
            }}
            role="slider"
            aria-label="Timeline"
            aria-valuemin={Math.round(t0)}
            aria-valuemax={Math.round(t1)}
            aria-valuenow={Math.round(currentMs)}
          >
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border transition-colors duration-300 group-hover:bg-foreground/25" />
            <div className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-foreground/80" style={{ width: `${Math.max(0, Math.min(100, ((currentMs - t0) / spanMs) * 100))}%` }} />
            {timelineMarkers(events, track, t0, spanMs).map((m) => (
              <div key={m.name} className="absolute top-1/2 -translate-x-1/2" style={{ left: `${m.pos}%` }} title={PHASE_LABEL[m.name]}>
                <span className="absolute left-1/2 block h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: PHASE_COLOR[m.name] }} />
                {m.label && (
                  <span className={`absolute left-1/2 -translate-x-1/2 text-[0.7rem] font-medium whitespace-nowrap text-muted-foreground ${m.label === 'above' ? 'bottom-3' : 'top-3'}`}>
                    {PHASE_LABEL[m.name]}
                  </span>
                )}
              </div>
            ))}
            <span
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-soft transition-transform duration-300 ease-soft group-hover:scale-125"
              style={{ left: `${Math.max(0, Math.min(100, ((currentMs - t0) / spanMs) * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">← → step one frame · space plays and pauses · click the timeline to jump</p>
        </div>

        {/* Report */}
        <aside className="lg:col-span-4">
          <RatingCard outcome={report.motion} onSeeBreakdown={() => document.getElementById('breakdown')?.scrollIntoView({ behavior: 'smooth' })} />

          <FootageTips tips={report.footage.tips} />

          <FootFaultPanel
            outcome={report.footFault}
            calibration={report.calibration}
            cameraMoving={report.clip.cameraMoving}
            track={track}
            onJump={seekFrame}
            onFixCourt={onFixCourt}
          />

          <PhasesPanel
            outcome={report.phases}
            track={track}
            onJump={seekFrame}
            contactOverride={report.contactOverride}
            onResetContact={() => onSetContact(null)}
          />

          <Collapsible className="mt-10 border-t pt-5">
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between text-sm font-semibold">
              Technical details
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-300 ease-soft group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Pose model</dt>
                <dd>{report.model.name} <span className="text-muted-foreground">({report.model.version})</span></dd>
                <dt className="text-muted-foreground">Frames</dt>
                <dd className="tabular">
                  {report.video.frames} over {seconds(t1 - t0)}{report.clip.count > 1 && ` (clip ${report.clip.index + 1} of ${report.clip.count})`}
                  {report.sampling === 'seek' && <span className="text-amber"> · approximate (frame-exact decoding unavailable in this browser)</span>}
                </dd>
                <dt className="text-muted-foreground">Video</dt>
                <dd className="tabular">{report.video.width} × {report.video.height}</dd>
                <dt className="text-muted-foreground">Calibration</dt>
                <dd>
                  {report.calibration.status === 'ok'
                    ? `${report.calibration.value.clicks.length} points` +
                      (report.calibration.value.residualCm !== null ? `, fit error ${report.calibration.value.residualCm.toFixed(1)} cm` : '')
                    : report.calibration.message}
                </dd>
                <dt className="text-muted-foreground">Versions</dt>
                <dd>app {report.appVersion} · params {report.paramsVersion}</dd>
              </dl>
            </CollapsibleContent>
          </Collapsible>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={onRestart}>
              Analyze another serve <ArrowRight />
            </Button>
            <Button variant="outline" size="lg" onClick={exportJson}>
              <Download /> Export data
            </Button>
          </div>
        </aside>
      </section>

      <Breakdown outcome={report.motion} track={track} focus={focus} onShow={showCheck} />
    </>
  );
}

function ModuleStatus({ outcome }: { outcome: Outcome<unknown> }) {
  if (outcome.status === 'skipped') return <p className="text-muted-foreground">{outcome.message}</p>;
  if (outcome.status === 'error') return <p className="border-l-2 border-clay pl-3 text-muted-foreground">Something went wrong: {outcome.message}</p>;
  return null;
}

function FootFaultPanel({
  outcome,
  calibration,
  cameraMoving,
  track,
  onJump,
  onFixCourt,
}: {
  outcome: Outcome<FootFaultResult>;
  calibration: ServeReport['calibration'];
  cameraMoving: boolean;
  track: PoseTrack;
  onJump: (i: number) => void;
  onFixCourt: () => void;
}) {
  const source = calibration.status === 'ok' ? calibration.value.source : undefined;
  return (
    <div className="mt-12">
      <p className="eyebrow">Foot fault check</p>
      {!cameraMoving && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          {source === 'auto' ? 'Court found automatically.' : source === 'manual' ? 'Court marked by hand.' : "Court lines weren't found."}
          <Button variant="link" size="xs" className="h-auto text-sm text-primary" onClick={onFixCourt}>
            {source ? 'Fix the court' : 'Mark the court'}
          </Button>
        </p>
      )}
      {outcome.status !== 'ok' ? (
        <>
          <p className="display mt-3 text-4xl text-muted-foreground">No call.</p>
          <div className="mt-4 text-sm"><ModuleStatus outcome={outcome} /></div>
        </>
      ) : (
        <>
          <p className={`display mt-3 text-[clamp(2.4rem,4vw,3.4rem)] ${VERDICT[outcome.value.verdict].cls}`}>{VERDICT[outcome.value.verdict].word}</p>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">{outcome.value.reason}</p>
          {outcome.value.minMarginCm !== null && outcome.value.frameIndex !== null && (
            <div className="mt-5">
              <p className="text-sm text-muted-foreground">Closest the foot got to the line</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="display tabular text-3xl">{Math.abs(outcome.value.minMarginCm).toFixed(1)}</span>
                <span className="text-lg font-semibold">cm</span>
                <span className="text-muted-foreground">{outcome.value.minMarginCm >= 0 ? 'behind' : 'over'}</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                ± {outcome.value.bandCm?.toFixed(1)} cm · {outcome.value.foot} foot ·{' '}
                <Button variant="link" size="xs" className="h-auto text-sm" onClick={() => onJump(outcome.value.frameIndex!)}>
                  at {seconds(track.frames[outcome.value.frameIndex]!.timeMs)}
                </Button>
              </p>
              <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-good" /> behind the line</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber" /> within ±</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-clay" /> over</span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PhasesPanel({
  outcome,
  track,
  onJump,
  contactOverride,
  onResetContact,
}: {
  outcome: Outcome<PhaseResult>;
  track: PoseTrack;
  onJump: (i: number) => void;
  contactOverride: number | null;
  onResetContact: () => void;
}) {
  return (
    <div className="mt-12">
      <h2 className="display text-3xl">Serve phases</h2>
      {outcome.status !== 'ok' ? (
        <div className="mt-3 text-sm"><ModuleStatus outcome={outcome} /></div>
      ) : (
        <>
          <ol className="mt-5">
            {PHASE_ORDER.map((n, k) => {
              const i = outcome.value.events[n];
              const prevName = PHASE_ORDER[k - 1];
              const prev = prevName ? outcome.value.events[prevName] : null;
              const t = i !== null ? track.frames[i]!.timeMs : null;
              const dt = t !== null && prev !== null && prev !== undefined ? t - track.frames[prev]!.timeMs : null;
              return (
                <li key={n} className="relative flex items-baseline gap-4 py-2.5 pl-6">
                  <span className="absolute top-[1.15rem] left-0 size-2.5 rounded-full" style={{ background: PHASE_COLOR[n] }} />
                  {k < PHASE_ORDER.length - 1 && <span className="absolute top-8 bottom-[-0.6rem] left-[4px] w-px bg-border" />}
                  <span className="flex-1">
                    {PHASE_LABEL[n]}
                    {n === 'contact' && contactOverride !== null && <span className="ml-2 text-xs text-muted-foreground">set by you</span>}
                  </span>
                  {t === null ? (
                    <span className="text-sm text-muted-foreground">not found</span>
                  ) : (
                    <button
                      onClick={() => onJump(i!)}
                      className="tabular rounded-sm text-sm font-semibold underline decoration-foreground/20 underline-offset-4 transition-colors duration-300 hover:decoration-foreground"
                    >
                      {seconds(t)}
                    </button>
                  )}
                  <span className="tabular w-16 text-right text-xs text-muted-foreground">{dt === null ? '' : `+${Math.round(dt)} ms`}</span>
                </li>
              );
            })}
          </ol>
          {contactOverride !== null && (
            <Button variant="link" size="xs" className="mt-2 text-muted-foreground" onClick={onResetContact}>
              <RotateCcw /> Detect contact automatically again
            </Button>
          )}
          {outcome.value.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 border-l-2 border-amber pl-3 text-sm text-muted-foreground">
              {outcome.value.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
