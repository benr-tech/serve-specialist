import { COURT, LANDMARKS, type LandmarkId } from '../court/court';

/** Top-down view of the server's half (baseline at the bottom, like the camera sees it), with the point to click highlighted. */
/** `view` turns the diagram so it matches the video: from behind, the baseline is nearest; from in front, it's farthest and left/right mirror. */
export function CourtDiagram({ active, done, view = 'behind' }: { active: LandmarkId | null; done: LandmarkId[]; view?: 'behind' | 'front' }) {
  const W = COURT.doublesHalfWidth + 0.6;
  const H = COURT.baselineToNet + 0.6;
  const f = view === 'front' ? -1 : 1;
  const sx = (x: number) => ((f * x + W) / (2 * W)) * 200;
  const syBehind = (y: number) => 222 - ((y + 0.6) / (H + 0.6)) * 214;
  const sy = (y: number) => (view === 'front' ? 230 - syBehind(y) : syBehind(y));
  const line = (x1: number, y1: number, x2: number, y2: number) => <line x1={sx(x1)} y1={sy(y1)} x2={sx(x2)} y2={sy(y2)} />;
  const s = COURT.singlesHalfWidth, d = COURT.doublesHalfWidth, sl = COURT.baselineToServiceLine, n = COURT.baselineToNet;
  return (
    <svg viewBox="0 0 200 230" className="w-full" role="img" aria-label="Court diagram showing which point to click next">
      <rect x="0" y="0" width="200" height="230" rx="14" className="fill-grass-deep" />
      <rect
        x={Math.min(sx(-d), sx(d))}
        y={Math.min(sy(0), sy(n))}
        width={Math.abs(sx(d) - sx(-d))}
        height={Math.abs(sy(0) - sy(n))}
        className="fill-grass"
      />
      <g className="stroke-court-line" strokeWidth="1.4">
        {line(-d, 0, d, 0)}
        {line(-s, sl, s, sl)}
        {line(-s, 0, -s, n)}
        {line(s, 0, s, n)}
        {line(-d, 0, -d, n)}
        {line(d, 0, d, n)}
        {line(0, sl, 0, n)}
        {line(0, 0, 0, 0.3)}
      </g>
      <line x1={Math.min(sx(-d), sx(d)) - 6} y1={sy(n)} x2={Math.max(sx(-d), sx(d)) + 6} y2={sy(n)} className="stroke-court-line/70" strokeWidth="3" strokeDasharray="2 2" />
      {Object.values(LANDMARKS).map((l) => {
        const isActive = l.id === active;
        const isDone = done.includes(l.id);
        return (
          <g key={l.id} transform={`translate(${sx(l.court.x)} ${sy(l.court.y)})`}>
            {isActive && <circle r="11" className="fill-ball/30 motion-safe:animate-ping" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />}
            <circle
              r={isActive ? 6 : 3.5}
              className={`transition-all duration-500 ease-soft ${isActive ? 'fill-ball stroke-[#1a1d19]' : isDone ? 'fill-ball' : 'fill-white/35'}`}
              strokeWidth={isActive ? 2 : 0}
            />
          </g>
        );
      })}
    </svg>
  );
}
