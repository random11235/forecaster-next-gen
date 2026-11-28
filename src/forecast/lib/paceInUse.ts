import type { ThroughputRange } from '../../engine/index.js'
import type { MilestoneInputs, PaceAction } from '../../model/milestoneInputs.js'
import { periodName, type PeriodName } from './cadence.js'
import { addDays, dayMonth, daysBetween } from './calendarDate.js'
import { counted } from './counted.js'
import type { ForecastSettings } from './settings.js'
import type { DatedCounts, PaceCalendar } from './periodCounts.js'
import type { PaceReading } from './paceReading.js'

// The pace in use, from the source the EM chose, and what stops or warns of it.

/** The milestone's choice of pace: the range, the typed counts, or the tracker's. */
export type ChosenPace = Pick<MilestoneInputs, 'paceMode' | 'paceRange' | 'paceCounts'>

/** The counts pace is drawn from: `all` of them, and `window`, those left once the milestone's pace action is applied. */
export interface PaceCounts {
  all: DatedCounts
  window: DatedCounts
}

/**
 * The pace the milestone's forecast uses, from the source the EM chose: the range (none until one is entered), the
 * typed counts, or the counts the connected `tracker` reads. Following the tracker, its `reading`, none until a
 * complete read reaches a whole period (`incomplete` when a read it would come from is incomplete), and the counts
 * that reading gives, none without one.
 */
export type PaceInUse =
  | { source: 'range'; range: ThroughputRange | undefined }
  | ({ source: 'counts' } & PaceCounts)
  | ({ source: 'tracker'; tracker: string; reading: PaceReading | undefined; incomplete: boolean } & PaceCounts)

/** Something the EM should know about pace, beside its input on Inputs, and on the forecast. */
export interface PaceNote {
  input: 'pace' | 'typedCounts'
  message: string
}

/** A note on pace as the forecast words it (`message`), and as the Inputs screen words it beside its input (`beside`). */
export interface PaceWarning extends PaceNote {
  beside: string
}

/**
 * The pace in use, from the source `chosen`, with what the connected tracker reads (`tracker`; none with no
 * connection, when following the tracker falls back to the typed counts).
 */
export function inUseOf(
  chosen: ChosenPace,
  tracker: { tracker: string; reading: PaceReading | undefined; incomplete: boolean } | undefined,
  of: PaceCalendar,
): PaceInUse {
  if (chosen.paceMode === 'range') return { source: 'range', range: chosen.paceRange }
  if (chosen.paceMode === 'tracker' && tracker) {
    return { source: 'tracker', ...tracker, ...withActionApplied(tracker.reading?.window ?? { counts: [], starts: [] }, of) }
  }
  return { source: 'counts', ...withActionApplied(datedTypedCounts(chosen.paceCounts, of), of) }
}

/** `all`, and the window the milestone's pace action leaves of them; all of them with none applied, or no start date. */
function withActionApplied(all: DatedCounts, { paceWindow: { action }, startDate }: PaceCalendar): PaceCounts {
  if (action === undefined || startDate === undefined) return { all, window: all }
  return { all, window: withAction(all, action) }
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

/**
 * The typed counts, dated back from the current period (the one holding today, in periods counted from the start
 * date): the last count is the most recent whole period. Undated with no start date.
 */
function datedTypedCounts(typed: readonly number[], { startDate, cadence, today }: PaceCalendar): DatedCounts {
  if (startDate === undefined) return { counts: [...typed], starts: [] }
  const current = Math.floor(daysBetween(startDate, today) / cadence)
  return { counts: [...typed], starts: typed.map((_, count) => addDays(startDate, (current - typed.length + count) * cadence)) }
}

type TypedCountsNeeded = ForecastSettings['typedCounts']

/** What stops a forecast from the pace in use, and the warnings about it, judged against `typedCounts`. */
export function notesOf(
  inUse: PaceInUse,
  of: PaceCalendar,
  { typedCounts: needed }: Pick<ForecastSettings, 'typedCounts'>,
): { problems: PaceNote[]; warnings: PaceWarning[] } {
  if (inUse.source === 'range') return { problems: inUse.range ? [] : [{ input: 'pace', message: 'Enter a pace range.' }], warnings: [] }
  if (inUse.source === 'tracker') return trackerPaceNotes(inUse, of, needed)
  return typedCountsNotes(inUse.window.counts.length, of, needed)
}

/**
 * Following the tracker, what stops a forecast from the counts in its window, and the warnings, as with typed counts:
 * none read yet, or none from an incomplete read, nothing finished in the periods read, fewer than `forForecast`, or
 * fewer than `reliable`.
 */
function trackerPaceNotes(
  { tracker, reading, incomplete, window }: Extract<PaceInUse, { source: 'tracker' }>,
  { cadence }: PaceCalendar,
  { forForecast, reliable }: TypedCountsNeeded,
): { problems: PaceNote[]; warnings: PaceWarning[] } {
  const inUse = window.counts.length
  const period = periodName(cadence)
  const instead = 'Type counts, or switch pace to the range.'
  const problem = (message: string) => ({ problems: [{ input: 'pace' as const, message }], warnings: [] })
  if (!reading && incomplete) {
    return problem(
      `${tracker} gave only part of the finished tickets its queries match, so its pace isn’t known. Narrow the query, or ${instead.toLowerCase()}`,
    )
  }
  if (!reading) return problem(`${tracker} hasn’t read the milestone’s finished tickets yet. Pick them in the Milestone step, or ${instead.toLowerCase()}`)
  // its bound leaves no periods counted: nothing finished, or every period skipped
  if (reading.said.problem) return problem(reading.said.problem)
  const counting = `${tracker}’s pace: ${reading.said.periods}${inUse === reading.window.counts.length ? '' : `, ${counted(inUse, period)} counted`}.`
  // a read reaching back too little for the window is widened by reading again, as far back as the milestone needs (#415)
  const readAgain = reading.said.readFurther ? `Read again to reach further back, ${instead.toLowerCase()}` : instead
  if (inUse < forForecast) return problem(`${counting} The forecast needs at least ${forForecast}. ${readAgain}`)
  if (inUse >= reliable) return { problems: [], warnings: [] }
  return {
    problems: [],
    warnings: [
      { input: 'pace', message: `${counting} The forecast needs ${reliable} to be reliable.`, beside: `${inUse} of ${reliable} needed for reliable results` },
    ],
  }
}

/**
 * The typed counts in use: too few to forecast from (one count isn't a pace), or enough but too few for a range the EM
 * can rely on.
 */
function typedCountsNotes(inUse: number, of: PaceCalendar, { forForecast, reliable }: TypedCountsNeeded): { problems: PaceNote[]; warnings: PaceWarning[] } {
  if (inUse < forForecast) {
    const message = `${typedCountsEntered(inUse, of)} The forecast needs at least ${forForecast}. Add another count, or switch pace to the range.`
    return { problems: [{ input: 'typedCounts', message }], warnings: [] }
  }
  if (inUse >= reliable) return { problems: [], warnings: [] }
  return {
    problems: [],
    warnings: [
      {
        input: 'typedCounts',
        message: `${typedCountsEntered(inUse, of)} The forecast needs ${reliable} to be reliable.`,
        beside: `${inUse} of ${reliable} needed for reliable results`,
      },
    ],
  }
}

/**
 * How many typed counts the pace is drawn from (`inUse`), in the milestone's periods: "Typed counts: 4 weeks
 * entered." With an action applied, how many it leaves: "Counting pace from 12 Oct leaves 4 weeks."
 */
function typedCountsEntered(inUse: number, { cadence, paceWindow: { action } }: PaceCalendar): string {
  const period = periodName(cadence)
  const periods = counted(inUse, period)
  return action ? `${actionSaid(action, period)} leaves ${periods}.` : `Typed counts: ${periods} entered.`
}
