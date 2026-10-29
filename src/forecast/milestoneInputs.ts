import type { ThroughputRange } from '../engine/index.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import { PACE_MODES, type MilestoneInputs, type PaceMode } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { periodName } from './cadence.js'
import { daysBetween, isCalendarDate } from './calendarDate.js'
import { counted } from './counted.js'
import { refuse, type EditResult, type Refusal } from './editResult.js'
import { DEFAULT_SETTINGS } from './settings.js'

/** How many typed counts the pace needs; not yet editable, so the defaults. */
const TYPED_COUNTS = DEFAULT_SETTINGS.typedCounts

/** Far above any real team's pace in one period; keeps typos like 1000000 out of the forecast. */
export const MAX_TICKETS_PER_PERIOD = 1000

/** Far above any real team's sprint; keeps typos out of the forecast, and its 156-period horizon within the calendar. */
export const MAX_CADENCE_DAYS = 365

/** Far above any real milestone; keeps typos out of the forecast. */
export const MAX_TICKETS_REMAINING = 100_000

/** A change the EM makes to the milestone on the Inputs screen, as typed. */
export type MilestoneInputsEdit =
  | { kind: 'setMilestone'; name: string; startDate: string; ticketsRemaining: string }
  /** Whole tickets per period, low ≤ high. */
  | { kind: 'setPaceRange'; low: string; high: string }
  /** One level for the whole milestone: `low`, `medium` or `high`. */
  | { kind: 'setAmbiguity'; level: string }
  /** Whole days in one of the team's periods, 1 or more. */
  | { kind: 'setCadence'; cadenceDays: string }
  /** The typed counts as a list: whole tickets done in each past period, oldest first, apart by commas or spaces. */
  | { kind: 'setPaceCounts'; counts: string }
  /** One more typed count, the newest: whole tickets done in the period just past. */
  | { kind: 'addPaceCount'; count: string }
  /** Drops the newest typed count, if there is one. */
  | { kind: 'removeLastPaceCount' }
  /** Which pace the forecast uses, `range` or `counts`; both are kept. */
  | { kind: 'setPaceMode'; paceMode: string }

/** An input of the milestone on the Inputs screen. */
export type MilestoneInput = 'name' | 'startDate' | 'ticketsRemaining' | 'pace'

/** Something the EM should know about one input: shown beside it on Inputs, and on the forecast. */
export interface InputNote {
  input: MilestoneInput
  message: string
}

/** The milestone as the Inputs screen shows it, with the start date pre-filled with today until one is entered. */
export interface MilestoneInputsView {
  name: string
  startDate: string
  ticketsRemaining: number | undefined
  /** How well the work is understood: medium until the EM chooses. */
  ambiguity: Ambiguity
  /** Days in one of the team's periods, which pace is entered in. */
  cadenceDays: number
  paceRange: ThroughputRange | undefined
  /** Tickets done in past periods, oldest first. */
  paceCounts: number[]
  /** Which pace the forecast uses. */
  paceMode: PaceMode
  /** What stops a forecast, then the warnings, each beside its input; none before anything is entered. */
  notes: InputNote[]
}

/** The milestone's inputs as the Inputs screen shows them: blank, but for the start date, until the EM enters one. */
export function milestoneInputsView(storage: Storage, teamId: string, today: string): MilestoneInputsView {
  const saved = storage.milestoneInputs(teamId)
  const inputs = saved ?? newMilestone(teamId)
  return {
    name: inputs.name,
    startDate: inputs.startDate ?? today,
    ticketsRemaining: inputs.ticketsRemaining,
    ambiguity: inputs.ambiguity,
    cadenceDays: inputs.cadenceDays,
    paceRange: inputs.paceRange,
    paceCounts: inputs.paceCounts,
    paceMode: inputs.paceMode,
    notes: saved
      ? [
          ...inputProblems(saved),
          ...warnings(saved, today).map(({ input, message, beside }) => ({ input, message: beside ?? message })),
        ]
      : [],
  }
}

/**
 * What the EM must enter before the milestone can be forecast: typed counts enough to forecast from, if they're in use,
 * and the inputs only a milestone kept from before the MVP lacks.
 */
export function inputProblems(inputs: MilestoneInputs): InputNote[] {
  return [
    ...(inputs.startDate === undefined ? [{ input: 'startDate', message: 'No start date is saved yet.' } as const] : []),
    ...(inputs.ticketsRemaining === undefined
      ? [{ input: 'ticketsRemaining', message: 'Enter how many tickets are left.' } as const]
      : []),
    ...(inputs.paceMode === 'range' && inputs.paceRange === undefined
      ? [{ input: 'pace', message: 'Enter a pace range.' } as const]
      : []),
    ...typedCountsShort(inputs),
  ]
}

/** A milestone with every input its forecast needs. */
export type ForecastableInputs = MilestoneInputs & { startDate: string; ticketsRemaining: number }

/** Whether the milestone can be forecast: whether nothing stops it, by the same test as `inputProblems`. */
export function isForecastable(inputs: MilestoneInputs): inputs is ForecastableInputs {
  return inputProblems(inputs).length === 0
}

/** Why the typed counts in use are too few to forecast from, if they are: one count isn't a pace. */
function typedCountsShort(inputs: MilestoneInputs): InputNote[] {
  if (inputs.paceMode !== 'counts' || inputs.paceCounts.length >= TYPED_COUNTS.forForecast) return []
  return [
    {
      input: 'pace',
      message: `${typedCountsEntered(inputs)} The forecast needs at least ${TYPED_COUNTS.forForecast}. Add another count, or switch pace to the range.`,
    },
  ]
}

/** How many typed counts there are, in the milestone's periods: "Typed counts: 4 weeks entered." */
function typedCountsEntered(inputs: MilestoneInputs): string {
  return `Typed counts: ${counted(inputs.paceCounts.length, periodName(inputs.cadenceDays))} entered.`
}

/** The pace the forecast uses: the range, or the typed counts, whichever the EM chose. */
export type PaceInUse = ({ source: 'range' } & ThroughputRange) | { source: 'counts'; counts: number[] }

/** The pace the milestone's forecast uses, or undefined until the chosen one is entered. */
export function paceInUse(inputs: MilestoneInputs): PaceInUse | undefined {
  if (inputs.paceMode === 'counts') return { source: 'counts', counts: inputs.paceCounts }
  return inputs.paceRange && { source: 'range', ...inputs.paceRange }
}

/** A warning as the forecast words it, and as the Inputs screen words it beside its input, if that differs. */
interface Warning extends InputNote {
  beside?: string
}

/** Inputs that can be forecast but give a forecast the EM should question, on `today`. */
export function inputWarnings(inputs: MilestoneInputs, today: string): InputNote[] {
  return warnings(inputs, today).map(({ input, message }) => ({ input, message }))
}

function warnings(inputs: MilestoneInputs, today: string): Warning[] {
  return [...startDateWarnings(inputs, today), ...paceWarnings(inputs), ...typedCountsWarnings(inputs)]
}

/** Typed counts enough to forecast from, but too few for a range the EM can rely on. */
function typedCountsWarnings(inputs: MilestoneInputs): Warning[] {
  const entered = inputs.paceCounts.length
  if (inputs.paceMode !== 'counts' || entered < TYPED_COUNTS.forForecast || entered >= TYPED_COUNTS.reliable) return []
  return [
    {
      input: 'pace',
      message: `${typedCountsEntered(inputs)} The forecast needs ${TYPED_COUNTS.reliable} to be reliable.`,
      beside: `${entered} of ${TYPED_COUNTS.reliable} needed for reliable results`,
    },
  ]
}

/** A start date before today forecasts "had we started then", from today's tickets remaining. */
function startDateWarnings(inputs: MilestoneInputs, today: string): InputNote[] {
  if (inputs.startDate === undefined) return []
  const daysBefore = daysBetween(inputs.startDate, today)
  if (daysBefore <= 0) return []
  return [{ input: 'startDate', message: `Start date is ${counted(daysBefore, 'day')} before today; tickets remaining are still today's count.` }]
}

function paceWarnings(inputs: MilestoneInputs): InputNote[] {
  const workLeft = (inputs.ticketsRemaining ?? 0) > 0
  const pace = paceInUse(inputs)
  const zeroPace = pace?.source === 'counts' ? pace.counts.every((count) => count === 0) : pace?.high === 0
  if (workLeft && zeroPace) {
    return [{ input: 'pace', message: `At 0 tickets a ${periodName(inputs.cadenceDays)}, the work never finishes.` }]
  }
  return []
}

/** Seam B, through `editInputs`: saves the EM's edit to the milestone. A refused edit changes nothing and says why. */
export function editMilestoneInputs(storage: Storage, teamId: string, edit: MilestoneInputsEdit): EditResult {
  const saved = storage.milestoneInputs(teamId)
  if (edit.kind === 'setMilestone') return save(storage, withMilestone(saved ?? newMilestone(teamId), edit))
  if (!saved) return refuse('Enter the milestone first.')
  return save(storage, edited(saved, edit))
}

/** The milestone as an edit leaves it, or why the edit was refused. */
type Edited = MilestoneInputs | Refusal

function save(storage: Storage, inputs: Edited): EditResult {
  if ('error' in inputs) return inputs
  storage.saveMilestoneInputs(inputs)
  return { ok: true }
}

function withMilestone(inputs: MilestoneInputs, edit: { name: string; startDate: string; ticketsRemaining: string }): Edited {
  const name = edit.name.trim()
  if (name === '') return refuse('Give the milestone a name.')
  if (!isCalendarDate(edit.startDate.trim())) return refuse('Enter the start date as a calendar date.')
  const tickets = wholeNumber(edit.ticketsRemaining)
  if (tickets === undefined) return refuse('Enter tickets remaining as a whole number, 0 or more.')
  if (tickets > MAX_TICKETS_REMAINING) return refuse(`Enter at most ${MAX_TICKETS_REMAINING} tickets remaining.`)
  return { ...inputs, name, startDate: edit.startDate.trim(), ticketsRemaining: tickets }
}

/** A saved milestone as any edit but the milestone's own leaves it. */
function edited(saved: MilestoneInputs, edit: Exclude<MilestoneInputsEdit, { kind: 'setMilestone' }>): Edited {
  switch (edit.kind) {
    case 'setPaceRange': {
      const [low, high] = [wholeNumber(edit.low), wholeNumber(edit.high)]
      if (low === undefined || high === undefined) return refuse('Enter whole numbers of tickets, 0 or more.')
      if (high > MAX_TICKETS_PER_PERIOD) return refuseAbovePerPeriodCap(saved)
      if (low > high) return refuse('The low end must not be above the high end.')
      return { ...saved, paceRange: { low, high } }
    }
    case 'setAmbiguity': {
      const level = AMBIGUITIES.find((ambiguity) => ambiguity === edit.level)
      if (level === undefined) return refuse('Choose low, medium or high ambiguity.')
      return { ...saved, ambiguity: level }
    }
    case 'setPaceCounts':
    case 'addPaceCount': {
      const typed = edit.kind === 'addPaceCount' ? [edit.count] : edit.counts.split(/[\s,]+/).filter((count) => count !== '')
      const counts = typed.map(wholeNumber)
      if (!counts.every((count) => count !== undefined)) return refuse('Enter typed counts as whole numbers of tickets, 0 or more.')
      if (counts.some((count) => count > MAX_TICKETS_PER_PERIOD)) return refuseAbovePerPeriodCap(saved)
      return { ...saved, paceCounts: edit.kind === 'addPaceCount' ? [...saved.paceCounts, ...counts] : counts }
    }
    case 'removeLastPaceCount':
      return { ...saved, paceCounts: saved.paceCounts.slice(0, -1) }
    case 'setPaceMode': {
      const paceMode = PACE_MODES.find((mode) => mode === edit.paceMode)
      if (paceMode === undefined) return refuse('Choose the range or typed counts.')
      return { ...saved, paceMode }
    }
    case 'setCadence': {
      const days = wholeNumber(edit.cadenceDays)
      if (days === undefined || days < 1) return refuse('Enter the cadence as a whole number of days, 1 or more.')
      if (days > MAX_CADENCE_DAYS) return refuse(`Enter a cadence of at most ${MAX_CADENCE_DAYS} days.`)
      return { ...saved, cadenceDays: days }
    }
  }
}

/** Refuses a pace above `MAX_TICKETS_PER_PERIOD` tickets in one period of the milestone's cadence. */
function refuseAbovePerPeriodCap(saved: MilestoneInputs): Refusal {
  return refuse(`Enter at most ${MAX_TICKETS_PER_PERIOD} tickets per ${periodName(saved.cadenceDays)}.`)
}

/** A milestone with every input the EM hasn't entered yet at its default. */
function newMilestone(teamId: string): MilestoneInputs {
  return {
    teamId,
    name: '',
    startDate: undefined,
    ticketsRemaining: undefined,
    ambiguity: 'medium',
    cadenceDays: 7,
    paceMode: 'range',
    paceRange: undefined,
    paceCounts: [],
  }
}

/** The typed value as a whole number, 0 or more, or undefined if it isn't one. */
function wholeNumber(typed: string): number | undefined {
  const trimmed = typed.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
}
