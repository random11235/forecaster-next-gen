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
 * stops a forecast; with finished comparable work ending it, to when.
 */
export interface BoundSaid {
  periods: string
  bars: boolean
  firstFinished?: string
  /** With finished comparable work ending the window, where: "To the last finished ticket, 15 Nov: comparable work has no open tickets." */
  lastFinished?: string
  problem?: string
}

/**
 * The tracker's window: the periods counted, the skipped ones it reaches back past, and what bounds it; and with
 * finished comparable work ending it, the day of its last finished ticket.
 */
export interface TrackerWindow {
  window: DatedCounts
  skipped: DatedCounts
  bound: TrackerWindowBound
  lastFinished: string | undefined
}

/**
 * The tracker's periods the pace counts, oldest first: of `pace` (every whole period its reads reach, the current one
 * left out), up to the `TRACKER_PERIODS` most recent, quiet ones 0, leaving out the quiet periods before the first
 * with a ticket finished in either read, the milestone's or comparable work's. With pace from comparable work that has
 * no open tickets, it ends at the period of its last finished ticket (`comparableWorkEnds`), leaving out those after:
 * nothing comparable was left to finish (#411). A period the EM skipped (its start in `skipped`) isn't counted: the
 * window reaches back past it, so the one before counts instead. And what bounds it.
 */
export function trackerWindow(
  pace: DatedCounts,
  { milestone, comparableWork, comparableWorkEnds }: Pick<SideBySide, 'milestone' | 'comparableWork' | 'comparableWorkEnds'>,
  skipped: readonly string[],
): TrackerWindow {
  const { counts, starts } = pace
  const ends = comparableWorkEnds && starts.includes(comparableWorkEnds.start) ? comparableWorkEnds : undefined
  const last = ends ? starts.indexOf(ends.start) : counts.length - 1
  const isSkipped = (period: number): boolean => skipped.includes(starts[period]!)
  const finished = new Set([pace, milestone, comparableWork].flatMap((read) => read?.starts.filter((_, at) => read.counts[at]! > 0) ?? []))
  const finishedIn = (period: number): boolean => finished.has(starts[period]!)
  const first = starts.findIndex((_, period) => period <= last && finishedIn(period) && !isSkipped(period))
  const passed: number[] = []
  const kept: number[] = []
  // the most recent first, back to the first finished ticket's period, passing over skipped ones
  for (let period = last; period >= Math.max(first, 0) && kept.length < TRACKER_PERIODS; period--) {
    if (isSkipped(period)) passed.unshift(period)
    else if (first >= 0) kept.unshift(period)
  }
  const dated = (periods: number[]): DatedCounts => ({ counts: periods.map((period) => counts[period]!), starts: periods.map((period) => starts[period]!) })
  const skips = dated(passed)
  if (first < 0) {
    const bound = passed.length > 0 && passed.length === last + 1 ? 'everySkipped' : passed.some(finishedIn) ? 'everyFinishedSkipped' : 'nothingFinished'
    return { window: dated([]), skipped: skips, bound, lastFinished: undefined }
  }
  const bound = kept.length === TRACKER_PERIODS ? 'full' : first > 0 ? 'firstFinished' : 'reach'
  return { window: dated(kept), skipped: skips, bound, lastFinished: ends?.day }
}

/** What a bound is said from: the tracker, the milestone's period, the window, the reads side by side and the counts pace comes from. */
export interface BoundFacts {
  tracker: string
  period: PeriodName
  window: DatedCounts
  sides: SideBySide
  counts: DatedCounts
}

/**
 * What the window says of itself: what its bound says (`BOUND_SAID`), and, ending at finished comparable work's last
 * ticket on `lastFinished`, that it stops there, its periods no longer the last.
 */
export function windowSaid(bound: TrackerWindowBound, facts: BoundFacts, lastFinished: string | undefined): BoundSaid {
  const said = BOUND_SAID[bound](facts)
  if (lastFinished === undefined) return said
  const periods = bound === 'full' ? counted(TRACKER_PERIODS, facts.period) : said.periods
  return { ...said, periods, lastFinished: `To the last finished ticket, ${dayMonth(lastFinished)}: comparable work has no open tickets.` }
}

/** What each bound says of the window, in one place: the reading's line, and the problem when it leaves no pace. */
const BOUND_SAID: Record<TrackerWindowBound, (facts: BoundFacts) => BoundSaid> = {
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
  nothingFinished: ({ tracker, period, counts }) => ({
    periods: `nothing finished in the ${counted(counts.counts.length, period)} ${tracker} reads`,
    bars: false,
    problem: `${tracker} has no finished tickets in the ${period}s it read, so there is no pace. Type counts, or switch pace to the range.`,
  }),
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
