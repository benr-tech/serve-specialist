import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Outcome } from '../analysis/analyze';
import {
  CATEGORY_LABEL, CATEGORY_ORDER, checkTimeMs, type CheckId, type CheckStatus, type MotionCheck, type MotionResult,
} from '../analysis/motion';
import type { PoseTrack } from '../pose/types';

export const STATUS_STYLE: Record<CheckStatus, { label: string; text: string; dot: string; stroke: string }> = {
  work_on: { label: 'Work on', text: 'text-clay', dot: 'bg-clay', stroke: '#d5562f' },
  ok: { label: 'Close', text: 'text-amber', dot: 'bg-amber', stroke: '#e2a53a' },
  good: { label: 'Good', text: 'text-good', dot: 'bg-good', stroke: '#3fae6a' },
  unmeasured: { label: 'Not measured', text: 'text-muted-foreground', dot: 'bg-border', stroke: '#8a8f84' },
};

/** Short label drawn next to the joint on the video when a check is shown. */
export function overlayLabel(c: MotionCheck): string {
  if (c.value === null) return '';
  const v = Math.round(c.value);
  if (c.id === 'knee_bend') return `${v}° bend`;
  if (c.id === 'leg_drive') return `${v}°/s`;
  if (c.id === 'pronation') return `${v}° turn`;
  return `${v}°`;
}

/** The headline card: the score, a score per area, and what to fix first. */
/** Green for a strong score, amber for middling, red for low. */
export function scoreColor(score: number) {
  return score >= 75 ? 'var(--good)' : score >= 55 ? 'var(--amber)' : 'var(--clay)';
}

function ScoreRing({ score }: { score: number }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--secondary)" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
          className="transition-[stroke-dashoffset] duration-1000 ease-soft"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="display tabular text-5xl">{score}</span>
        <span className="text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}

/** The headline card: the score, a score per area, and what to fix first. */
export function RatingCard({ outcome, onSeeBreakdown }: { outcome: Outcome<MotionResult>; onSeeBreakdown: () => void }) {
  const r = outcome.status === 'ok' ? outcome.value : null;
  // Checks are already sorted worst-first, heaviest-first.
  const fixes = (r?.checks ?? []).filter((c) => c.status === 'work_on').slice(0, 3);

  return (
    <div className="rounded-2xl bg-card p-6 shadow-soft sm:p-7">
      <p className="eyebrow">Serve motion</p>
      {r?.score != null ? (
        <>
          <div className="mt-4 flex items-center gap-6">
            <ScoreRing score={r.score} />
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                From {r.measuredCount} of {r.checks.length} checks.
              </p>
              {r.confidence === 'rough' && (
                <p className="mt-2 text-sm leading-snug text-amber">Rough read: this video limits detail. Filming tips are below.</p>
              )}
            </div>
          </div>
          <ul className="mt-6 space-y-3 border-t pt-5">
            {CATEGORY_ORDER.map((cat) => {
              const c = r.categories[cat];
              return (
                <li key={cat} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{CATEGORY_LABEL[cat]}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-secondary">
                    <span
                      className="block h-full rounded-full transition-[width] duration-700 ease-soft"
                      style={{ width: `${c.score ?? 0}%`, background: c.score === null ? 'transparent' : scoreColor(c.score) }}
                    />
                  </span>
                  <span className="tabular text-right font-semibold">{c.score ?? '–'}</span>
                </li>
              );
            })}
          </ul>
          {fixes.length > 0 ? (
            <p className="mt-6 border-t pt-5 text-[0.95rem] leading-relaxed">
              Fix first: <strong className="font-semibold">{fixes.map((f) => f.title.toLowerCase()).join(', ')}</strong>.{' '}
              <Button variant="link" size="xs" className="h-auto align-baseline text-[0.95rem] text-primary" onClick={onSeeBreakdown}>
                See the breakdown
              </Button>
            </p>
          ) : (
            <p className="mt-6 border-t pt-5 text-[0.95rem]">Every check that could be measured looked good.</p>
          )}
        </>
      ) : (
        <>
          <p className="display mt-3 text-4xl text-muted-foreground">No score yet</p>
          <p className="mt-3 text-sm text-muted-foreground">
            {outcome.status === 'ok' ? 'Too little of the body was visible to score this serve. See the filming tips below.' : outcome.message}
          </p>
        </>
      )}
    </div>
  );
}

/** Every check, grouped by area, with the measurement, a tip, and a button that shows the moment on the video. */
export function Breakdown({
  outcome,
  track,
  focus,
  onShow,
}: {
  outcome: Outcome<MotionResult>;
  track: PoseTrack;
  focus: CheckId | null;
  onShow: (id: CheckId) => void;
}) {
  if (outcome.status !== 'ok') return null;
  const r = outcome.value;
  return (
    <section id="breakdown" className="mt-24 grid scroll-mt-8 gap-x-14 gap-y-8 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-8">
          <h2 className="display text-4xl">The breakdown</h2>
          <p className="mt-4 max-w-sm text-muted-foreground">
            Each check measures one part of the motion at one moment. Press <span className="font-semibold text-foreground">Show me</span> to
            jump there and see the measurement drawn on the video.
          </p>
        </div>
      </div>
      <div className="space-y-16 lg:col-span-8">
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat}>
            <div className="flex items-baseline justify-between border-b pb-3">
              <h3 className="display text-2xl">{CATEGORY_LABEL[cat]}</h3>
              <span className="display tabular text-2xl" style={{ color: r.categories[cat].score === null ? undefined : scoreColor(r.categories[cat].score!) }}>
                {r.categories[cat].score ?? '–'}
              </span>
            </div>
            <ol>
              {r.checks
                .filter((c) => c.category === cat)
                .map((c) => (
                  <CheckRow key={c.id} c={c} t={checkTimeMs(track, c)} active={focus === c.id} onShow={() => onShow(c.id)} />
                ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

function CheckRow({ c, t, active, onShow }: { c: MotionCheck; t: number | null; active: boolean; onShow: () => void }) {
  const st = STATUS_STYLE[c.status];
  return (
    <li
      className={`grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t py-6 transition-colors duration-500 ease-soft first:border-t-0 sm:grid-cols-[8.5rem_1fr_auto] ${active ? '-mx-4 rounded-2xl border-transparent bg-secondary/70 px-4' : ''}`}
    >
      <span className={`flex items-center gap-2 self-start pt-1.5 text-sm font-semibold ${st.text} max-sm:col-span-2`}>
        <span className={`size-2 rounded-full ${st.dot}`} /> {st.label}
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xl font-bold">
          {c.title}
          {c.confidence === 'rough' && c.status !== 'unmeasured' && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">rough</span>
          )}
        </p>
        {c.measured && <p className="tabular mt-1 text-sm text-muted-foreground">{c.measured}</p>}
        {c.tip && <p className="mt-3 max-w-xl leading-relaxed">{c.tip}</p>}
      </div>
      <div className="self-start">
        {c.frameIndex !== null && (
          <Button variant={active ? 'default' : 'outline'} size="sm" onClick={onShow}>
            <Eye /> Show me{t !== null && <span className="tabular font-normal opacity-70">{(t / 1000).toFixed(2)} s</span>}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Filming tips when the footage itself limits what can be measured. */
export function FootageTips({ tips }: { tips: string[] }) {
  if (tips.length === 0) return null;
  return (
    <div className="mt-10">
      <p className="eyebrow">Get a better read</p>
      <p className="mt-2 text-sm text-muted-foreground">This video limits what can be measured. For next time:</p>
      <ol className="mt-4 space-y-3 text-[0.95rem] leading-snug">
        {tips.map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="tabular font-semibold">{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
