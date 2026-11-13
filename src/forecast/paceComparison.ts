import type { PeriodName } from './cadence.js'

/** Paces whose medians are this close, a period, are about the same. */
export const ABOUT_THE_SAME_WITHIN = 0.5

/** With fewer periods of its own than this since its start, the milestone has too few to compare a pace with. */
export const FEWEST_OWN_PERIODS = 3

/**
 * How a pace compares with the milestone's own so far, by their medians a period: faster or slower `by` how much,
 * about the same, or not compared, as the milestone has too few periods of its own (`ownPeriods`). `own` is the
 * milestone's own median a period.
 */
export type PaceComparison =
  | { kind: 'tooFew'; ownPeriods: number }
  | { kind: 'aboutTheSame'; own: number }
  | { kind: 'faster' | 'slower'; by: number; own: number }

/**
 * Seam B: how a pace, the tickets finished in each of its periods, compares with the milestone's own, its finished
 * tickets in each period since its start date: by their medians, about the same within `ABOUT_THE_SAME_WITHIN` a
 * period, and too few to compare with fewer than `FEWEST_OWN_PERIODS` periods of the milestone's own. The Comparable
 * work step compares the pace in use with it; its candidates are grouped by it.
 */
export function comparedWithOwn(pace: readonly number[], own: readonly number[]): PaceComparison {
  if (own.length < FEWEST_OWN_PERIODS) return { kind: 'tooFew', ownPeriods: own.length }
  const ownMedian = median(own)
  const by = median(pace) - ownMedian
  if (Math.abs(by) <= ABOUT_THE_SAME_WITHIN) return { kind: 'aboutTheSame', own: ownMedian }
  return { kind: by > 0 ? 'faster' : 'slower', by: Math.abs(by), own: ownMedian }
}

/** The comparison as the step says it: "↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)". */
export function comparisonSaid(comparison: PaceComparison, period: PeriodName): string {
  switch (comparison.kind) {
    case 'tooFew':
      return `The milestone has ${comparison.ownPeriods} ${period}${comparison.ownPeriods === 1 ? '' : 's'} of its own so far: too few to compare.`
    case 'aboutTheSame':
      return `About the same as the milestone’s own so far (${perPeriod(comparison.own, period)}).`
    default:
      return `${comparison.kind === 'faster' ? '↑' : '↓'} ${perPeriod(comparison.by, period)} ${comparison.kind} than the milestone’s own so far (${perPeriod(comparison.own, period)})`
  }
}

/** A number of tickets a period, to one decimal place: "1.5 a week". */
export function perPeriod(tickets: number, period: PeriodName): string {
  return `${Math.round(tickets * 10) / 10} a ${period}`
}

/** The middle of `counts`, or the mean of the middle two; 0 for none. */
export function median(counts: readonly number[]): number {
  if (counts.length === 0) return 0
  const sorted = [...counts].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
