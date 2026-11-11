import type { MilestoneInputs, PaceAction } from '../model/milestoneInputs.js'
import { addDays, dayMonth, daysBetween } from './calendarDate.js'
import type { PeriodName } from './cadence.js'

/** Counts, oldest first, each period starting on the date at the same place in `starts`. */
export interface DatedCounts {
  counts: number[]
  starts: string[]
}

/**
 * The milestone's typed counts dated back from the current period on `today`, the last being the most recent whole
 * one, and those of them the pace is drawn from once its action is applied.
 */
export function paceWindow(inputs: MilestoneInputs, today: string): { typed: DatedCounts; window: DatedCounts } {
  const counts = inputs.paceCounts
  const starts = inputs.startDate === undefined ? [] : typedCountStarts(counts.length, inputs.startDate, inputs.cadenceDays, today)
  const typed = { counts: [...counts], starts }
  const action = inputs.paceWindow.action
  if (action === undefined || inputs.startDate === undefined) return { typed, window: typed }
  return { typed, window: withAction(typed, action) }
}

/**
 * The first day of each typed count's period, oldest first. They are dated back from the current period (the one
 * holding `today`, in periods counted from the start date): the last count is the most recent whole period.
 */
function typedCountStarts(counts: number, startDate: string, periodDays: number, today: string): string[] {
  const current = Math.floor(daysBetween(startDate, today) / periodDays)
  return Array.from({ length: counts }, (_, count) => addDays(startDate, (current - counts + count) * periodDays))
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
