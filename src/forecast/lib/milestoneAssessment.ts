import type { ThroughputRange } from '../../engine/index.js'
import type { MilestoneInputs } from '../../model/milestoneInputs.js'
import { periodName } from './cadence.js'
import { daysBetween } from './calendarDate.js'
import { counted } from './counted.js'
import type { Pace, PaceInUse } from './pace.js'
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
export type ForecastPace =
  ({ source: 'range' } & ThroughputRange) | { source: 'counts'; counts: number[] } | { source: 'tracker'; tracker: string; counts: number[]; skipped: number }

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
 * Seam B, behind both views: assesses the milestone's inputs on `today`, with its pace (`paceOf`: the pace in use, and
 * what stops a forecast from it or warns of it) and what the team's tracker measures (`measured`; none with no
 * connection, when every value is typed, as in the MVP).
 */
export function assessMilestone(
  inputs: MilestoneInputs,
  today: string,
  { inUse, problems: paceProblems, warnings: paceNotes }: Pick<Pace, 'problems' | 'warnings'> & { inUse: PaceInUse },
  measured: Measured | undefined,
): MilestoneAssessment {
  const pace = forecastPace(inUse)
  const tickets = ticketsInUse(inputs, measured)
  const warnings = [
    ...startDateWarnings(inputs, today),
    ...paceWarnings(inputs, tickets.count, pace),
    ...(inUse.source === 'tracker' ? [] : paceCadenceWarnings(inputs)),
    ...paceNotes,
  ]
  const problems = [
    ...(inputs.startDate === undefined ? [{ input: 'startDate', message: 'No start date is saved yet.' } as const] : []),
    ...(tickets.problem ? [{ input: 'ticketsRemaining', message: tickets.problem } as const] : []),
    ...paceProblems,
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
  if (inUse.source === 'tracker')
    return { source: 'tracker', tracker: inUse.tracker, counts: inUse.window.counts, skipped: inUse.reading?.skipped.starts.length ?? 0 }
  return inUse.range && { source: 'range', ...inUse.range }
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
  const zeroPace = pace !== undefined && pace.source !== 'range' ? pace.counts.length > 0 && pace.counts.every((count) => count === 0) : pace?.high === 0
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
