import { useEffect, useState } from 'react';
import { analyzeClip, analyzeVideo, type AnalysisContext, type ClipAnalysis } from './analysis/analyze';
import type { Segment } from './analysis/segments';
import type { PoseTrack, Side } from './pose/types';
import { AnalyzeStep } from './ui/AnalyzeStep';
import { Brand } from './ui/Brand';
import { CalibrateStep } from './ui/CalibrateStep';
import { ResultsStep } from './ui/ResultsStep';
import { UploadStep } from './ui/UploadStep';

interface Results {
  file: File; url: string; ctx: AnalysisContext;
  raw: PoseTrack; segments: Segment[]; clips: ClipAnalysis[]; selected: number;
}

type State =
  | { step: 'upload' }
  | { step: 'analyze'; file: File; url: string; hand: Side }
  | ({ step: 'results' } & Results)
  /** Marking the court by hand, then back to the same results. */
  | ({ step: 'calibrate' } & Results);

/** Default clip to show: the one the court was marked on, else the one with the most measurable checks. */
function pickClip(clips: ClipAnalysis[], ctx: AnalysisContext): number {
  if (ctx.clicks.length && ctx.calibrationTimeMs !== null) {
    const i = clips.findIndex((c) => ctx.calibrationTimeMs! >= c.report.clip.startMs - 1 && ctx.calibrationTimeMs! <= c.report.clip.endMs + 1);
    if (i >= 0) return i;
  }
  let best = 0, bestCoverage = -1;
  clips.forEach((c, i) => {
    const cov = c.report.motion.status === 'ok' ? c.report.motion.value.coverage : 0;
    if (cov > bestCoverage) [best, bestCoverage] = [i, cov];
  });
  return best;
}

const STEPS = ['Upload', 'Analyze', 'Report'] as const;
const STEP_INDEX: Record<State['step'], number> = { upload: 0, analyze: 1, results: 2, calibrate: 2 };

export function App() {
  const [state, setState] = useState<State>({ step: 'upload' });

  // Free the video's object URL when it's no longer used.
  const url = 'url' in state ? state.url : null;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const restart = () => setState({ step: 'upload' });
  const current = STEP_INDEX[state.step];

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-24 sm:px-8 lg:px-12">
      <header className="flex items-center justify-between gap-6 border-b py-5">
        <button onClick={restart} className="rounded-md transition-opacity duration-300 hover:opacity-70" aria-label="Serve Specialist, start over">
          <Brand />
        </button>
        <div className="flex items-center gap-4" aria-label={`Step ${current + 1} of ${STEPS.length}: ${STEPS[current]}`}>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            <span className="tabular font-semibold text-foreground">{current + 1}</span>/{STEPS.length} · {STEPS[current]}
          </span>
          <div className="flex gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1 rounded-full transition-all duration-500 ease-soft ${i === current ? 'w-8 bg-foreground' : i < current ? 'w-3 bg-foreground/40' : 'w-3 bg-border'}`}
              />
            ))}
          </div>
        </div>
      </header>

      <main key={state.step} className="animate-rise pt-8">
        {state.step === 'upload' && (
          <UploadStep onReady={(file, hand) => setState({ step: 'analyze', file, hand, url: URL.createObjectURL(file) })} />
        )}
        {state.step === 'analyze' && (
          <AnalyzeStep
            file={state.file}
            videoUrl={state.url}
            onCancel={restart}
            onDone={(raw, stills) => {
              const ctx: AnalysisContext = { clicks: [], calibrationTimeMs: null, hand: state.hand, fileName: state.file.name, stills };
              const { segments, clips } = analyzeVideo(raw, ctx);
              setState({ step: 'results', file: state.file, url: state.url, ctx, raw, segments, clips, selected: pickClip(clips, ctx) });
            }}
          />
        )}
        {state.step === 'calibrate' && (
          <CalibrateStep
            videoUrl={state.url}
            startTimeMs={state.clips[state.selected]!.report.clip.startMs}
            onBack={() => setState({ ...state, step: 'results' })}
            onDone={(clicks, calibrationTimeMs) => {
              const ctx: AnalysisContext = { ...state.ctx, clicks, calibrationTimeMs };
              const { segments, clips } = analyzeVideo(state.raw, ctx);
              setState({ ...state, step: 'results', ctx, segments, clips });
            }}
          />
        )}
        {state.step === 'results' && (
          <ResultsStep
            videoUrl={state.url}
            track={state.clips[state.selected]!.track}
            report={state.clips[state.selected]!.report}
            clips={state.clips}
            selected={state.selected}
            onSelectClip={(selected) => setState({ ...state, selected })}
            onRestart={restart}
            onFixCourt={() => setState({ ...state, step: 'calibrate' })}
            onSetContact={(frame) => {
              const clips = [...state.clips];
              clips[state.selected] = analyzeClip(state.raw, state.segments, state.selected, state.ctx, frame);
              setState({ ...state, clips });
            }}
          />
        )}
      </main>
    </div>
  );
}
