import type { MilestoneInputs, PaceAction, PaceMode } from '../model/milestoneInputs.js'
import { addDays, dayMonth, daysBetween } from './calendarDate.js'
import type { PeriodName } from './cadence.js'
import type { Measured } from './trackerReads.js'

/** Counts, oldest first, each period starting on the date at the same place in `starts`. */
export interface DatedCounts {
  counts: number[]
  starts: string[]
}

/**
 * The pace the forecast uses, as the EM chose it, with what the tracker measures (`measured`; none with no
 * connection): following the tracker falls back to the typed counts with no connection to follow.
 */
export function paceSource(inputs: MilestoneInputs, measured: Measured | undefined): PaceMode {
  return inputs.paceMode === 'tracker' && !measured ? 'counts' : inputs.paceMode
}

/**
 * The counts pace is drawn from, `all`: following the tracker, the tracker's window (`trackerWindow`); otherwise the
 * typed counts, dated back from the current period on `today`, the last being the most recent whole one. And `window`,
 * those of them the pace is drawn from once its action is applied.
 */
export function paceWindow(inputs: MilestoneInputs, today: string, measured?: Measured): { all: DatedCounts; window: DatedCounts } {
  const all = paceSource(inputs, measured) === 'tracker' ? (measured?.pace?.window ?? { counts: [], starts: [] }) : typedCounts(inputs, today)
  const action = inputs.paceWindow.action
  if (action === undefined || inputs.startDate === undefined) return { all, window: all }
  return { all, window: withAction(all, action) }
}

/** The milestone's typed counts, dated back from the current period on `today`. */
function typedCounts(inputs: MilestoneInputs, today: string): DatedCounts {
  const counts = inputs.paceCounts
  const starts = inputs.startDate === undefined ? [] : typedCountStarts(counts.length, inputs.startDate, inputs.cadenceDays, today)
  return { counts: [...counts], starts }
}

/**
 * The first day of each typed count's period, oldest first. They are dated back from the current period (the one
 * holding `today`, in periods counted from the start date): the last count is the most recent whole period.
 */
function typedCountStarts(counts: number, startDate: string, periodDays: number, today: string): string[] {
  const current = Math.floor(daysBetween(startDate, today) / periodDays)
  return Array.from({ length: counts }, (_, count) => addDays(startDate, (current - counts + count) * periodDays))
}

/** The most periods the tracker's pace counts. */
export const TRACKER_PERIODS = 8

/**
 * What bounds the tracker's window: it is `full`, at `TRACKER_PERIODS`; or shorter, as the periods the reads reach run
 * out (`reach`), or as the quiet periods before the first finished ticket are left out (`firstFinished`); or empty,
 * with `nothingFinished` in any period the reads reach that isn't skipped, or with every period that finished
 * something skipped (`everySkipped`).
 */
export type TrackerWindowBound = 'full' | 'reach' | 'firstFinished' | 'nothingFinished' | 'everySkipped'

/** The tracker's window (`trackerWindow`): the periods counted, the skipped ones it reaches back past, and what bounds it. */
export interface TrackerWindow {
  window: DatedCounts
  /** The periods the EM skipped that the window reaches back past, oldest first, with what each finished. */
  skipped: DatedCounts
  bound: TrackerWindowBound
}

/**
 * The tracker's periods the pace counts, oldest first: of `available` (every whole period its reads reach, the
 * current one left out), up to the `TRACKER_PERIODS` most recent, quiet ones 0, leaving out the quiet periods before
 * the first with a finished ticket. A period the EM skipped (its start in `skipped`) isn't counted: the window reaches
 * back past it, so the one before counts instead. And what bounds it.
 */
export function trackerWindow(available: DatedCounts, skipped: readonly string[] = []): TrackerWindow {
  const isSkipped = (period: number): boolean => skipped.includes(available.starts[period]!)
  const first = available.counts.findIndex((count, period) => count > 0 && !isSkipped(period))
  const passed: number[] = []
  const kept: number[] = []
  // the most recent first, back to the first finished ticket's period, passing over skipped ones
  for (let period = available.counts.length - 1; period >= Math.max(first, 0) && kept.length < TRACKER_PERIODS; period--) {
    if (isSkipped(period)) passed.unshift(period)
    else if (first >= 0) kept.unshift(period)
  }
  const dated = (periods: number[]): DatedCounts => ({ counts: periods.map((period) => available.counts[period]!), starts: periods.map((period) => available.starts[period]!) })
  const skips = dated(passed)
  if (first < 0) return { window: dated([]), skipped: skips, bound: skips.counts.some((count) => count > 0) ? 'everySkipped' : 'nothingFinished' }
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
