/**
 * How a pace compares with the milestone's own so far (#158): faster or slower by how much a period, about the same
 * (within `ABOUT_THE_SAME` a period), or too few to compare, when the milestone has under `FEWEST_TO_COMPARE` periods
 * of its own.
 */
export type PaceVersus = { kind: 'faster' | 'slower'; by: number } | { kind: 'aboutTheSame' } | { kind: 'tooFewToCompare' }

/** How near the milestone's own median a pace is about the same, a period. */
export const ABOUT_THE_SAME = 0.5

/** The fewest periods of its own the milestone needs before a pace is compared with it. */
export const FEWEST_TO_COMPARE = 3

/**
 * Seam B: how a median a period compares with the milestone's own: the median of `ownCounts`, its finished tickets in
 * each period since its start date.
 */
export function paceVersusMilestoneOwn(median: number, ownCounts: readonly number[]): PaceVersus {
  if (ownCounts.length < FEWEST_TO_COMPARE) return { kind: 'tooFewToCompare' }
  const difference = median - medianOf(ownCounts)
  if (Math.abs(difference) <= ABOUT_THE_SAME) return { kind: 'aboutTheSame' }
  return { kind: difference > 0 ? 'faster' : 'slower', by: Math.abs(difference) }
}

/** The median of `values`, of which there is at least one. */
export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2
}
