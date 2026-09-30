/** Pure helpers for the browser image compressor, kept apart so they can be unit tested. */

/** Fits a size inside `maxSide` on its longest side. Never enlarges. Whole pixels, at least 1. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide)
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const ratio = maxSide / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export const SCALE_STEPS = [1, 0.85, 0.7, 0.55] as const;
export const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

/**
 * The encoding attempts to try, best first: full size at every quality, then a
 * smaller size at every quality, and so on. The first attempt that fits the
 * target size wins.
 */
export function compressionPlan(): { scale: number; quality: number }[] {
  return SCALE_STEPS.flatMap((scale) => QUALITY_STEPS.map((quality) => ({ scale, quality })));
}
