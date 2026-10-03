/**
 * Tennis court model in court coordinates (metres).
 * Origin: center of the baseline's back (outer) edge. +x: server's right facing the net. +y: toward the net.
 * Landmarks are at line *centers* because that's where people click.
 * Dimensions: ITF Rules of Tennis, Appendix (measured to the outer edges of lines).
 */
import type { Point } from '../geometry/types';

export const LINE_WIDTH_M = 0.05; // assumption; ITF allows the baseline up to 0.10
const HALF = LINE_WIDTH_M / 2;

export const COURT = {
  singlesHalfWidth: 8.23 / 2,
  doublesHalfWidth: 10.97 / 2,
  baselineToServiceLine: 5.485,
  baselineToNet: 23.77 / 2,
  centerMarkLength: 0.1,
} as const;

export type LandmarkId =
  | 'baseline_singles_left' | 'baseline_singles_right'
  | 'service_singles_left' | 'service_singles_right'
  | 'center_mark' | 'service_T'
  | 'baseline_doubles_left' | 'baseline_doubles_right';

export interface Landmark {
  id: LandmarkId;
  label: string;
  court: Point;
}

const sx = COURT.singlesHalfWidth - HALF;
const dx = COURT.doublesHalfWidth - HALF;
const baseY = HALF;
const serviceY = COURT.baselineToServiceLine - HALF;

export const LANDMARKS: Record<LandmarkId, Landmark> = {
  baseline_singles_left: { id: 'baseline_singles_left', label: 'Baseline × left singles sideline', court: { x: -sx, y: baseY } },
  baseline_singles_right: { id: 'baseline_singles_right', label: 'Baseline × right singles sideline', court: { x: sx, y: baseY } },
  service_singles_right: { id: 'service_singles_right', label: 'Service line × right singles sideline', court: { x: sx, y: serviceY } },
  service_singles_left: { id: 'service_singles_left', label: 'Service line × left singles sideline', court: { x: -sx, y: serviceY } },
  center_mark: { id: 'center_mark', label: 'Center mark (on baseline)', court: { x: 0, y: baseY } },
  service_T: { id: 'service_T', label: 'T (service line × center line)', court: { x: 0, y: serviceY } },
  baseline_doubles_left: { id: 'baseline_doubles_left', label: 'Baseline × left doubles sideline', court: { x: -dx, y: baseY } },
  baseline_doubles_right: { id: 'baseline_doubles_right', label: 'Baseline × right doubles sideline', court: { x: dx, y: baseY } },
};

/** Click order shown to the user. First 4 required, last 2 optional. */
export const CALIBRATION_ORDER: LandmarkId[] = [
  'baseline_singles_left', 'baseline_singles_right', 'service_singles_right', 'service_singles_left',
  'center_mark', 'service_T',
];
export const REQUIRED_POINTS = 4;

/** Line segments (court metres) for drawing the server's half of the court as a calibration check. */
export const COURT_LINES: [Point, Point][] = [
  [{ x: -dx, y: baseY }, { x: dx, y: baseY }], // baseline
  [{ x: -sx, y: serviceY }, { x: sx, y: serviceY }], // service line
  [{ x: -sx, y: 0 }, { x: -sx, y: COURT.baselineToNet }], // singles sidelines
  [{ x: sx, y: 0 }, { x: sx, y: COURT.baselineToNet }],
  [{ x: -dx, y: 0 }, { x: -dx, y: COURT.baselineToNet }], // doubles sidelines
  [{ x: dx, y: 0 }, { x: dx, y: COURT.baselineToNet }],
  [{ x: 0, y: serviceY }, { x: 0, y: COURT.baselineToNet }], // center service line
  [{ x: 0, y: 0 }, { x: 0, y: COURT.centerMarkLength }], // center mark
  [{ x: -dx, y: COURT.baselineToNet }, { x: dx, y: COURT.baselineToNet }], // net
];
