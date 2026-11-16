import type { PaceAction } from '../model/milestoneInputs.js'
import { dayMonth } from './calendarDate.js'
import type { PeriodName } from './cadence.js'
import type { PaceReads } from './paceReads.js'

/** Counts, oldest first, each period starting on the date at the same place in `starts`. */
export interface DatedCounts {
  counts: number[]
  starts: string[]
}

/** The same counts, in the same order; never with none to compare. */
export function sameCounts(some: readonly number[], others: readonly number[] | undefined): boolean {
  return others !== undefined && some.length === others.length && some.every((count, period) => count === others[period])
}

/** The most periods the tracker's pace counts. */
export const TRACKER_PERIODS = 8

/**
 * What bounds the tracker's window: it is `full`, at `TRACKER_PERIODS`; or shorter, as the periods the reads reach run
 * out (`reach`), or as the quiet periods before the first finished ticket are left out (`firstFinished`); or empty,
 * with every period the reads reach skipped (`everySkipped`), with every one that finished something skipped
 * (`everyFinishedSkipped`), or with `nothingFinished` in any of them.
 */
export type TrackerWindowBound = 'full' | 'reach' | 'firstFinished' | 'nothingFinished' | 'everySkipped' | 'everyFinishedSkipped'

/** The tracker's window (`trackerWindow`): the periods counted, the skipped ones it reaches back past, and what bounds it. */
export interface TrackerWindow {
  window: DatedCounts
  /** The periods the EM skipped that the window reaches back past, oldest first, with what each finished. */
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
  { pace, milestone, comparableWork }: Pick<PaceReads, 'pace' | 'milestone' | 'comparableWork'>,
  skipped: readonly string[] = [],
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

/** The counts the pace is drawn from once `action` is applied: those from its period on, or all but its period. */
export function withAction({ counts, starts }: DatedCounts, action: PaceAction): DatedCounts {
  // ISO calendar dates order as strings do
  const kept = (i: number) => (action.kind === 'startFrom' ? starts[i]! >= action.date : starts[i] !== action.period)
  return { counts: counts.filter((_, i) => kept(i)), starts: starts.filter((_, i) => kept(i)) }
}

/** The applied action as a clause: "Counting pace from 12 Oct", "Leaving out the week of 12 Oct". */
export function actionSaid(action: PaceAction, period: PeriodName): string {
  return action.kind === 'startFrom' ? `Counting pace from ${dayMonth(action.date)}` : `Leaving out the ${period} of ${dayMonth(action.period)}`
}
