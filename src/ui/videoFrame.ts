/**
 * Classes for the video + overlay box. Landscape videos fill the column; portrait (phone held
 * upright) videos are capped in height and centered, so they don't become enormous. The box wraps
 * the video exactly, so overlay canvases (absolute, inset-0) stay aligned either way.
 */
export function videoFrameClasses(width: number, height: number) {
  const portrait = height > width * 1.05;
  return portrait
    ? { box: 'relative mx-auto w-fit max-w-full overflow-hidden rounded-2xl bg-black shadow-lift', video: 'block h-auto max-h-[72vh] w-auto max-w-full' }
    : { box: 'relative overflow-hidden rounded-2xl bg-black shadow-lift', video: 'block h-auto w-full' };
}
