/** Wordmark: a tennis ball (with its seam) and the name. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle cx="12" cy="12" r="11" className="fill-ball" />
        <path d="M4.2 4.6c3.6 3.4 3.6 11.4 0 14.8M19.8 4.6c-3.6 3.4-3.6 11.4 0 14.8" className="fill-none stroke-white/90" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="display text-[1.35rem] leading-none">Serve Specialist</span>
    </div>
  );
}
