import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Side } from '../pose/types';
import { CourtIllustration } from './CourtIllustration';
import { HandToggle } from './HandToggle';

const STEPS = [
  { title: 'Film one serve', body: 'Prop your phone on the fence, a bag or a tripod. Behind, in front or at a diagonal all work.' },
  { title: 'Upload it', body: 'The court lines are found automatically, so foot positions are measured in real centimetres. You can fix them if needed.' },
  { title: 'Get your breakdown', body: 'A score for the whole motion, what to work on, every phase timed, and a foot-fault check.' },
];

const TIPS = [
  'Fill at least half the height of the picture, with both baseline corners in view.',
  'Film at 60 fps and keep the phone still.',
  'Send the original file (AirDrop), not a texted copy.',
];

export function UploadStep({ onReady }: { onReady: (file: File, hand: Side) => void }) {
  const [hand, setHand] = useState<Side>('right');
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setRejected(true);
      return;
    }
    onReady(f, hand);
  };

  return (
    <>
      <section className="grid items-center gap-x-14 gap-y-12 pt-4 lg:grid-cols-12 lg:pt-12">
        <div className="lg:col-span-5">
          <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">Serve analysis for tennis</p>
          <h1 className="display mt-4 text-[clamp(2.8rem,6vw,4.6rem)]">
            Your serve,
            <br />
            <span className="marker">broken down.</span>
          </h1>
          <p className="mt-6 max-w-[28rem] text-lg leading-relaxed text-muted-foreground">
            Upload one serve from your phone. Serve Specialist follows the whole motion from toss to landing, scores it, shows
            what to work on, and checks your feet for foot faults.
          </p>

          <div className="mt-8 space-y-3">
            <p className="text-sm font-semibold">Which hand do you hit with?</p>
            <HandToggle value={hand} onChange={setHand} />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => input.current?.click()}>
              <Upload /> Upload a serve video
            </Button>
            <Button size="lg" variant="outline" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>
              How it works
            </Button>
          </div>
          {rejected && <p className="mt-4 text-sm text-clay">That file isn't a video. Try an MP4 or MOV.</p>}
          <p className="mt-6 text-sm text-muted-foreground">Analyzed on your device. Your video is never uploaded.</p>
        </div>

        <div className="lg:col-span-7">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a serve video"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
            className={`group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl border-2 shadow-lift outline-none transition-[border-color,transform] duration-300 ease-soft focus-visible:border-primary ${dragging ? 'scale-[1.01] border-primary' : 'border-transparent hover:border-primary/60'}`}
          >
            <CourtIllustration className="absolute inset-0 size-full transition-transform duration-700 ease-soft group-hover:scale-[1.02]" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 top-0 p-6 text-white sm:p-8">
              <p className="display text-3xl sm:text-4xl">{dragging ? 'Drop it here' : 'Drag a serve video here'}</p>
              <p className="mt-2 text-sm text-white/80">MP4 or MOV · one or more serves · under 20 seconds</p>
            </div>
            <input ref={input} type="file" accept="video/*" hidden onChange={(e) => take(e.target.files)} />
          </div>
        </div>
      </section>

      <section id="how" className="mt-24 scroll-mt-8">
        <h2 className="display text-3xl">How it works</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl bg-card p-6">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <p className="mt-4 text-lg font-bold">{s.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border p-6">
          <p className="font-bold">For the best results</p>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
            {TIPS.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
