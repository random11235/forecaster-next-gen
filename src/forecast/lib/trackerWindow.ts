import type { PeriodName } from './cadence.js'
import { dayMonth } from './calendarDate.js'
import { counted } from './counted.js'
import { TRACKER_PERIODS } from './queryRead.js'
import type { DatedCounts, SideBySide } from './periodCounts.js'

// The tracker's pace window: the periods it counts, the skipped ones it reaches back past, and what its bound says.

/**
 * What bounds the tracker's window: it is `full`, at `TRACKER_PERIODS`; or shorter, as the periods the reads reach run
 * out (`reach`), or as the quiet periods before the first finished ticket are left out (`firstFinished`); or empty,
 * with every period the reads reach skipped (`everySkipped`), with every one that finished something skipped
 * (`everyFinishedSkipped`), or with `nothingFinished` in any of them.
 */
export type TrackerWindowBound = 'full' | 'reach' | 'firstFinished' | 'nothingFinished' | 'everySkipped' | 'everyFinishedSkipped'

/**
 * What a bound says of the window: its periods, as the reading's line says them; whether they are bars to show; with
 * the quiet periods before the first finished ticket left out, from when; and with none counted, the problem that
 * stops a forecast.
 */
export interface BoundSaid {
  periods: string
  bars: boolean
  firstFinished?: string
  problem?: string
}

/** The tracker's window: the periods counted, the skipped ones it reaches back past, and what bounds it. */
export interface TrackerWindow {
  window: DatedCounts
  skipped: DatedCounts
  bound: TrackerWindowBound
}

/**
 * The tracker's periods the pace counts, oldest first: of `pace` (every whole period its reads reach, the current one
 * left out), up to the `TRACKER_PERIODS` most recent, quiet ones 0, leaving out the quiet periods before the first
 * with a ticket finished in either read, the milestone's or comparable work's. A period the EM skipped (its start in
 * `skipped`) isn't counted: the window reaches back past it, so the one before counts instead. And what bounds it.
 */
export function trackerWindow(
  pace: DatedCounts,
  { milestone, comparableWork }: Pick<SideBySide, 'milestone' | 'comparableWork'>,
  skipped: readonly string[],
): TrackerWindow {
  const { counts, starts } = pace
  const isSkipped = (period: number): boolean => skipped.includes(starts[period]!)
  const finished = new Set([pace, milestone, comparableWork].flatMap((read) => read?.starts.filter((_, at) => read.counts[at]! > 0) ?? []))
  const finishedIn = (period: number): boolean => finished.has(starts[period]!)
  const first = starts.findIndex((_, period) => finishedIn(period) && !isSkipped(period))
  const passed: number[] = []
  const kept: number[] = []
  // the most recent first, back to the first finished ticket's period, passing over skipped ones
  for (let period = counts.length - 1; period >= Math.max(first, 0) && kept.length < TRACKER_PERIODS; period--) {
    if (isSkipped(period)) passed.unshift(period)
    else if (first >= 0) kept.unshift(period)
  }
  const dated = (periods: number[]): DatedCounts => ({ counts: periods.map((period) => counts[period]!), starts: periods.map((period) => starts[period]!) })
  const skips = dated(passed)
  if (first < 0) {
    const bound = passed.length > 0 && passed.length === counts.length ? 'everySkipped' : passed.some(finishedIn) ? 'everyFinishedSkipped' : 'nothingFinished'
    return { window: dated([]), skipped: skips, bound }
  }
  const bound = kept.length === TRACKER_PERIODS ? 'full' : first > 0 ? 'firstFinished' : 'reach'
  return { window: dated(kept), skipped: skips, bound }
}

/** What a bound is said from: the tracker, the milestone's period, the window, the reads side by side and the counts pace comes from. */
export interface BoundFacts {
  tracker: string
  period: PeriodName
  window: DatedCounts
  sides: SideBySide
  counts: DatedCounts
}

/** What each bound says of the window, in one place: the reading's line, and the problem when it leaves no pace. */
export const BOUND_SAID: Record<TrackerWindowBound, (facts: BoundFacts) => BoundSaid> = {
  full: ({ period }) => ({ periods: `last ${counted(TRACKER_PERIODS, period)}`, bars: true }),
  firstFinished: ({ period, window }) => ({
    periods: counted(window.counts.length, period),
    bars: true,
    firstFinished: `From the first finished ticket, ${dayMonth(window.starts[0]!)}.`,
  }),
  reach: ({ tracker, period, window, sides }) => ({
    // the milestone's own pace counts only the periods since its start date
    periods: `${counted(window.counts.length, period)} · ${sides.from === 'milestone' && sides.beforeStart > 0 ? 'since the start date' : `${tracker} has nothing before ${periodOf(period, window.starts[0]!)}`}`,
    bars: true,
  }),
  // with nothing finished there are no bars
  nothingFinished: ({ tracker, period, counts, sides }) => {
    const before = finishedBeforeStart(sides)
    if (before === 0) {
      return {
        periods: `nothing finished in the ${counted(counts.counts.length, period)} ${tracker} reads`,
        bars: false,
        problem: `${tracker} has no finished tickets in the ${period}s it read, so there is no pace. Type counts, or switch pace to the range.`,
      }
    }
    // the milestone's own pace counts only the periods since its start date, so what finished before it is said, not hidden (#405)
    const since = counts.counts.length
    return {
      periods: `${since === 0 ? `no ${period} since the start date has ended` : `nothing finished in the ${counted(since, period)} since the start date`} · ${tracker} finished ${before} before it`,
      bars: false,
      problem: `The milestone’s own pace counts only the ${period}s since its start date, and ${since === 0 ? 'none has ended yet' : 'nothing finished in them'}: the ${counted(before, 'ticket')} ${tracker} finished before it ${before === 1 ? 'doesn’t' : 'don’t'} count. Add comparable work, type counts, or switch pace to the range.`,
    }
  },
  // with every period skipped, the bars show the gaps to count again
  everySkipped: ({ tracker, period }) => ({
    periods: `every ${period} skipped`,
    bars: true,
    problem: `Every ${period} is skipped, so ${tracker} gives no pace. Count a ${period} again, or use typed counts or the range.`,
  }),
  everyFinishedSkipped: ({ tracker, period }) => ({
    periods: `every ${period} that finished something skipped`,
    bars: true,
    problem: `Every ${period} that finished something is skipped, so ${tracker} gives no pace. Count a ${period} again, or use typed counts or the range.`,
  }),
}

/** The tickets the milestone's own read finished in the periods before its start date, when pace is its own; else 0. */
function finishedBeforeStart(sides: SideBySide): number {
  if (sides.from !== 'milestone') return 0
  return sides.milestone.counts.slice(0, sides.beforeStart).reduce((sum, count) => sum + count, 0)
}

/**
 * The skipped periods the window reaches back past, and what it counts instead: "2 skipped (12 Oct, 19 Oct), reaching
 * back to w/c 31 Aug"; "…, and GitHub has no earlier weeks to count instead" short of 8; "…, so no weeks count".
 */
export function skippedLine(skipped: DatedCounts, window: DatedCounts, period: PeriodName, tracker: string): string | undefined {
  if (skipped.starts.length === 0) return undefined
  const which = `${skipped.starts.length} skipped (${skipped.starts.map(dayMonth).join(', ')})`
  const first = window.starts[0]
  if (first === undefined) return `${which}, so no ${period}s count`
  if (window.starts.length < TRACKER_PERIODS) return `${which}, and ${tracker} has no earlier ${period}s to count instead`
  return `${which}, reaching back to ${periodOf(period, first)}`
}

/** The period starting on `start`, as the reading's lines name it: "w/c 31 Aug", "the sprint of 31 Aug". */
function periodOf(period: PeriodName, start: string): string {
  return `${period === 'week' ? 'w/c' : 'the sprint of'} ${dayMonth(start)}`
}
