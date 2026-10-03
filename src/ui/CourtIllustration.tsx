import { COURT } from '../court/court';

/**
 * The court as a phone behind the baseline sees it (the filming position in DATA.md).
 * Drawn with a real pinhole projection, so the perspective is honest.
 */
const W = 400, H = 300;
const CAM = { x: -1.1, y: -7, height: 5.4, focal: 260, horizon: 72 };

function project(x: number, y: number): [number, number] {
  const depth = y - CAM.y;
  return [W / 2 + (CAM.focal * (x - CAM.x)) / depth, CAM.horizon + (CAM.focal * CAM.height) / depth];
}

const { singlesHalfWidth: s, doublesHalfWidth: d, baselineToServiceLine: sl, baselineToNet: n } = COURT;
const L = 2 * n; // far baseline
const LINES: [number, number, number, number][] = [
  [-d, 0, d, 0], [-d, L, d, L], // baselines
  [-s, sl, s, sl], [-s, L - sl, s, L - sl], // service lines
  [-s, 0, -s, L], [s, 0, s, L], // singles sidelines
  [-d, 0, -d, L], [d, 0, d, L], // doubles sidelines
  [0, sl, 0, L - sl], // center service line
  [0, 0, 0, 0.25], [0, L, 0, L - 0.25], // center marks
];

const pts = (...p: [number, number][]) => p.map(([x, y]) => project(x, y).join(',')).join(' ');

export function CourtIllustration({ className = '' }: { className?: string }) {
  const [bx, by] = project(-3.2, 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <rect width={W} height={H} className="fill-grass-deep" />
      <polygon points={pts([-d - 1.5, -6], [d + 1.5, -6], [d + 1.5, L + 3], [-d - 1.5, L + 3])} className="fill-grass" />
      <g className="stroke-court-line" strokeWidth="2.2" strokeLinecap="round">
        {LINES.map(([x1, y1, x2, y2], i) => {
          const [a, b] = project(x1, y1);
          const [c, e] = project(x2, y2);
          return <line key={i} x1={a} y1={b} x2={c} y2={e} />;
        })}
      </g>
      {/* net */}
      <polyline points={pts([-d - 0.9, n], [d + 0.9, n])} className="stroke-court-line/80" strokeWidth="5" />
      <polyline points={pts([-d - 0.9, n], [d + 0.9, n])} className="stroke-black/30" strokeWidth="2" strokeDasharray="2 2" />
      {/* a ball waiting by the baseline */}
      <ellipse cx={bx + 3} cy={by + 5} rx="7" ry="2.5" className="fill-black/25" />
      <circle cx={bx} cy={by} r="6" className="fill-ball" />
    </svg>
  );
}
