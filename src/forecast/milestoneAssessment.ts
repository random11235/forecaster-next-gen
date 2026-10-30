import type { ThroughputRange } from '../engine/index.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import { periodName } from './cadence.js'
import { daysBetween } from './calendarDate.js'
import { counted } from './counted.js'
import type { ForecastSettings } from './settings.js'

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

/** The pace the forecast uses: the range, or the typed counts, whichever the EM chose. */
export type PaceInUse = ({ source: 'range' } & ThroughputRange) | { source: 'counts'; counts: number[] }

/** A milestone with every input its forecast needs. */
export type ForecastableInputs = MilestoneInputs & { startDate: string; ticketsRemaining: number }

/**
 * The milestone's inputs judged against the settings on a day: either what stops a forecast, or the inputs and pace it
 * runs on. Either way, the warnings about inputs the EM should question. Warnings about the forecast's result, such as
 * the horizon warning, need the engine's result, so `milestoneForecastView` adds them after these.
 */
export type MilestoneAssessment =
  | { forecastable: false; problems: InputNote[]; warnings: Warning[] }
  | { forecastable: true; inputs: ForecastableInputs; pace: PaceInUse; warnings: Warning[] }

/** Seam B, behind both views: assesses the milestone's inputs against `settings` on `today`. */
export function assessMilestone(inputs: MilestoneInputs, settings: ForecastSettings, today: string): MilestoneAssessment {
  const { typedCounts } = settings
  const warnings = [...startDateWarnings(inputs, today), ...paceWarnings(inputs), ...typedCountsWarnings(inputs, typedCounts)]
  const pace = paceInUse(inputs)
  const problems = [
    ...(inputs.startDate === undefined ? [{ input: 'startDate', message: 'No start date is saved yet.' } as const] : []),
    ...(inputs.ticketsRemaining === undefined
      ? [{ input: 'ticketsRemaining', message: 'Enter how many tickets are left.' } as const]
      : []),
    ...(pace === undefined ? [{ input: 'pace', message: 'Enter a pace range.' } as const] : []),
    ...typedCountsShort(inputs, typedCounts),
  ]
  const { startDate, ticketsRemaining } = inputs
  if (problems.length > 0 || pace === undefined || startDate === undefined || ticketsRemaining === undefined) {
    return { forecastable: false, problems, warnings }
  }
  return { forecastable: true, inputs: { ...inputs, startDate, ticketsRemaining }, pace, warnings }
}

/** The pace the milestone's forecast uses, or undefined until the chosen one is entered. */
function paceInUse(inputs: MilestoneInputs): PaceInUse | undefined {
  if (inputs.paceMode === 'counts') return { source: 'counts', counts: inputs.paceCounts }
  return inputs.paceRange && { source: 'range', ...inputs.paceRange }
}

type TypedCounts = ForecastSettings['typedCounts']

/** Why the typed counts in use are too few to forecast from, if they are: one count isn't a pace. */
function typedCountsShort(inputs: MilestoneInputs, { forForecast }: TypedCounts): InputNote[] {
  if (inputs.paceMode !== 'counts' || inputs.paceCounts.length >= forForecast) return []
  return [
    {
      input: 'typedCounts',
      message: `${typedCountsEntered(inputs)} The forecast needs at least ${forForecast}. Add another count, or switch pace to the range.`,
    },
  ]
}

/** How many typed counts there are, in the milestone's periods: "Typed counts: 4 weeks entered." */
function typedCountsEntered(inputs: MilestoneInputs): string {
  return `Typed counts: ${counted(inputs.paceCounts.length, periodName(inputs.cadenceDays))} entered.`
}

/** Typed counts enough to forecast from, but too few for a range the EM can rely on. */
function typedCountsWarnings(inputs: MilestoneInputs, { forForecast, reliable }: TypedCounts): Warning[] {
  const entered = inputs.paceCounts.length
  if (inputs.paceMode !== 'counts' || entered < forForecast || entered >= reliable) return []
  return [
    {
      input: 'typedCounts',
      message: `${typedCountsEntered(inputs)} The forecast needs ${reliable} to be reliable.`,
      beside: `${entered} of ${reliable} needed for reliable results`,
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

function paceWarnings(inputs: MilestoneInputs): Warning[] {
  const workLeft = (inputs.ticketsRemaining ?? 0) > 0
  const pace = paceInUse(inputs)
  // with no counts typed yet, the too-few-counts problem says what to do
  const zeroPace =
    pace?.source === 'counts' ? pace.counts.length > 0 && pace.counts.every((count) => count === 0) : pace?.high === 0
  if (workLeft && zeroPace) return [worded('pace', `At 0 tickets a ${periodName(inputs.cadenceDays)}, the work never finishes.`)]
  return []
}

/** A warning worded the same on the forecast and beside its input. */
function worded(input: MilestoneInput, message: string): Warning {
  return { input, message, beside: message }
}
