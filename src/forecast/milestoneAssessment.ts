import type { ThroughputRange } from '../engine/index.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import { periodName } from './cadence.js'
import { daysBetween } from './calendarDate.js'
import { counted } from './counted.js'
import type { PaceInUse } from './paceInUse.js'
import { actionSaid } from './paceWindow.js'
import type { ForecastSettings } from './settings.js'
import type { Measured } from './trackerReads.js'

/** An input of the milestone on the Inputs screen. */
export type MilestoneInput = 'name' | 'startDate' | 'ticketsRemaining' | 'pace' | 'typedCounts'

/** Something the EM should know about one input: shown beside it on Inputs, and on the forecast. */
export interface InputNote {
  input: MilestoneInput
  message: string
}

/** A warning as the forecast words it (`message`), and as the Inputs screen words it beside its input (`beside`). */
export interface Warning extends InputNote {
  beside: string
}

/**
 * The pace the forecast runs on: the range, the typed counts, or the counts the connected `tracker` reads, with how many
 * periods the EM skipped among them, whichever the EM chose; the counts are those in the pace window.
 */
export type ForecastPace = ({ source: 'range' } & ThroughputRange) | { source: 'counts'; counts: number[] } | { source: 'tracker'; tracker: string; counts: number[]; skipped: number }

/** A milestone with every input its forecast needs, its tickets remaining the ones in use, from the source the EM chose. */
export type ForecastableInputs = MilestoneInputs & { startDate: string; ticketsRemaining: number }

/**
 * The milestone's inputs judged against the settings on a day: either what stops a forecast, or the inputs and pace it
 * runs on. Either way, the warnings about inputs the EM should question. Warnings about the forecast's result, such as
 * the horizon warning, need the engine's result, so `milestoneForecastView` adds them after these.
 */
export type MilestoneAssessment =
  | { forecastable: false; problems: InputNote[]; warnings: Warning[] }
  | { forecastable: true; inputs: ForecastableInputs; pace: ForecastPace; warnings: Warning[] }

/**
 * Seam B, behind both views: assesses the milestone's inputs against `settings` on `today`, with the pace in use
 * (`inUse`) and what the team's tracker measures (`measured`; none with no connection, when every value is typed, as
 * in the MVP).
 */
export function assessMilestone(inputs: MilestoneInputs, settings: ForecastSettings, today: string, inUse: PaceInUse, measured: Measured | undefined): MilestoneAssessment {
  const { typedCounts } = settings
  const { source } = inUse
  // the counts the pace is drawn from: those in its window
  const inWindow = inUse.source === 'range' ? [] : inUse.window.counts
  const pace = forecastPace(inUse)
  const tickets = ticketsInUse(inputs, measured)
  const tracker = inUse.source === 'tracker' ? trackerPaceNotes(inputs, inUse, typedCounts) : { problems: [], warnings: [] }
  const warnings = [
    ...startDateWarnings(inputs, today),
    ...paceWarnings(inputs, tickets.count, pace),
    ...(source === 'tracker' ? [] : paceCadenceWarnings(inputs)),
    ...(source === 'counts' ? typedCountsWarnings(inputs, inWindow.length, typedCounts) : []),
    ...tracker.warnings,
  ]
  const problems = [
    ...(inputs.startDate === undefined ? [{ input: 'startDate', message: 'No start date is saved yet.' } as const] : []),
    ...(tickets.problem ? [{ input: 'ticketsRemaining', message: tickets.problem } as const] : []),
    ...(pace === undefined ? [{ input: 'pace', message: 'Enter a pace range.' } as const] : []),
    ...(source === 'counts' ? typedCountsShort(inputs, inWindow.length, typedCounts) : []),
    ...tracker.problems,
  ]
  const { startDate } = inputs
  const ticketsRemaining = tickets.count
  if (problems.length > 0 || pace === undefined || startDate === undefined || ticketsRemaining === undefined) {
    return { forecastable: false, problems, warnings }
  }
  return { forecastable: true, inputs: { ...inputs, startDate, ticketsRemaining }, pace, warnings }
}

/**
 * The tickets remaining the forecast uses, from the source the EM chose: typed, or, with a connection, the tracker's
 * latest reading of the milestone query. Or why there are none: nothing typed, nothing read, or a read that is
 * incomplete, whose count is only part of the tickets.
 */
function ticketsInUse(inputs: MilestoneInputs, measured: Measured | undefined): { count: number | undefined; problem?: string } {
  if (!measured || inputs.ticketsSource === 'typed') {
    return inputs.ticketsRemaining === undefined ? { count: undefined, problem: 'Enter how many tickets are left.' } : { count: inputs.ticketsRemaining }
  }
  const { tracker, ticketsRemaining: reading } = measured
  if (!reading) {
    return { count: undefined, problem: `${tracker} hasn’t read the milestone’s tickets yet. Pick them in the Milestone step, or type tickets remaining.` }
  }
  if (reading.incomplete) {
    return {
      count: undefined,
      problem: `${tracker} gave only part of the milestone’s tickets, so tickets remaining isn’t known. Narrow the milestone query, or type tickets remaining.`,
    }
  }
  return { count: reading.count }
}

/** The pace the forecast runs on, from the pace in use, or undefined until the range chosen is entered. */
function forecastPace(inUse: PaceInUse): ForecastPace | undefined {
  if (inUse.source === 'counts') return { source: 'counts', counts: inUse.window.counts }
  if (inUse.source === 'tracker') return { source: 'tracker', tracker: inUse.tracker, counts: inUse.window.counts, skipped: inUse.reading?.skipped.starts.length ?? 0 }
  return inUse.range && { source: 'range', ...inUse.range }
}

/**
 * Following the tracker, what stops a forecast from the counts in its window, and the warnings, as with typed counts:
 * none read yet, or none from an incomplete read, nothing finished in the periods read, fewer than `forForecast`, or
 * fewer than `reliable`.
 */
function trackerPaceNotes(
  inputs: MilestoneInputs,
  { tracker, reading: pace, incomplete, window }: Extract<PaceInUse, { source: 'tracker' }>,
  { forForecast, reliable }: TypedCounts,
): { problems: InputNote[]; warnings: Warning[] } {
  const inUse = window.counts.length
  const period = periodName(inputs.cadenceDays)
  const instead = 'Type counts, or switch pace to the range.'
  const problem = (message: string) => ({ problems: [{ input: 'pace' as const, message }], warnings: [] })
  if (!pace && incomplete) {
    return problem(`${tracker} gave only part of the finished tickets its queries match, so its pace isn’t known. Narrow the query, or ${instead.toLowerCase()}`)
  }
  if (!pace) return problem(`${tracker} hasn’t read the milestone’s finished tickets yet. Pick them in the Milestone step, or ${instead.toLowerCase()}`)
  const skippedEvery = pace.bound === 'everySkipped' ? `Every ${period} is skipped` : pace.bound === 'everyFinishedSkipped' ? `Every ${period} that finished something is skipped` : undefined
  if (skippedEvery) return problem(`${skippedEvery}, so ${tracker} gives no pace. Count a ${period} again, or use typed counts or the range.`)
  if (pace.bound === 'nothingFinished') return problem(`${tracker} has no finished tickets in the ${period}s it read, so there is no pace. ${instead}`)
  const counting = `${tracker}’s pace: ${pace.periods}${inUse === pace.window.counts.length ? '' : `, ${counted(inUse, period)} counted`}.`
  if (inUse < forForecast) return problem(`${counting} The forecast needs at least ${forForecast}. ${instead}`)
  if (inUse >= reliable) return { problems: [], warnings: [] }
  return {
    problems: [],
    warnings: [{ input: 'pace', message: `${counting} The forecast needs ${reliable} to be reliable.`, beside: `${inUse} of ${reliable} needed for reliable results` }],
  }
}

type TypedCounts = ForecastSettings['typedCounts']

/** Why the typed counts in use are too few to forecast from, if they are: one count isn't a pace. */
function typedCountsShort(inputs: MilestoneInputs, inUse: number, { forForecast }: TypedCounts): InputNote[] {
  if (inUse >= forForecast) return []
  return [
    {
      input: 'typedCounts',
      message: `${typedCountsEntered(inputs, inUse)} The forecast needs at least ${forForecast}. Add another count, or switch pace to the range.`,
    },
  ]
}

/**
 * How many typed counts the pace is drawn from (`inUse`), in the milestone's periods: "Typed counts: 4 weeks
 * entered." With an action applied, how many it leaves: "Counting pace from 12 Oct leaves 4 weeks."
 */
function typedCountsEntered(inputs: MilestoneInputs, inUse: number): string {
  const period = periodName(inputs.cadenceDays)
  const action = inputs.paceWindow.action
  const periods = counted(inUse, period)
  return action ? `${actionSaid(action, period)} leaves ${periods}.` : `Typed counts: ${periods} entered.`
}

/** Typed counts enough to forecast from, but too few for a range the EM can rely on. */
function typedCountsWarnings(inputs: MilestoneInputs, inUse: number, { forForecast, reliable }: TypedCounts): Warning[] {
  if (inUse < forForecast || inUse >= reliable) return []
  return [
    {
      input: 'typedCounts',
      message: `${typedCountsEntered(inputs, inUse)} The forecast needs ${reliable} to be reliable.`,
      beside: `${inUse} of ${reliable} needed for reliable results`,
    },
  ]
}

/** A start date before today forecasts "had we started then", from today's tickets remaining. */
function startDateWarnings(inputs: MilestoneInputs, today: string): Warning[] {
  if (inputs.startDate === undefined) return []
  const daysBefore = daysBetween(inputs.startDate, today)
  if (daysBefore <= 0) return []
  return [worded('startDate', `Start date is ${counted(daysBefore, 'day')} before today; tickets remaining are still today's count.`)]
}

function paceWarnings(inputs: MilestoneInputs, ticketsRemaining: number | undefined, pace: ForecastPace | undefined): Warning[] {
  const workLeft = (ticketsRemaining ?? 0) > 0
  // with no counts typed yet, the too-few-counts problem says what to do
  const zeroPace =
    pace !== undefined && pace.source !== 'range' ? pace.counts.length > 0 && pace.counts.every((count) => count === 0) : pace?.high === 0
  if (workLeft && zeroPace) return [worded('pace', `At 0 tickets a ${periodName(inputs.cadenceDays)}, the work never finishes.`)]
  return []
}

/** A pace entered in another cadence: changing the cadence keeps its numbers, so 4–8 a week becomes 4–8 a sprint. */
function paceCadenceWarnings({ cadenceDays, paceCadenceDays, paceRange, paceCounts }: MilestoneInputs): Warning[] {
  const paceEntered = paceRange !== undefined || paceCounts.length > 0
  if (!paceEntered || paceCadenceDays === undefined || paceCadenceDays === cadenceDays) return []
  const check = 'Please verify that the per period numbers are aligned.'
  return [{ input: 'pace', message: `Pace: cadence length has changed. ${check}`, beside: `Cadence length has changed. ${check}` }]
}

/** A warning worded the same on the forecast and beside its input. */
function worded(input: MilestoneInput, message: string): Warning {
  return { input, message, beside: message }
}
