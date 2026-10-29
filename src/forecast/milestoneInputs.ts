import type { ThroughputRange } from '../engine/index.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import { PACE_MODES, type MilestoneInputs, type PaceMode } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { periodName } from './cadence.js'
import { daysBetween, isCalendarDate } from './calendarDate.js'
import { counted } from './counted.js'
import { refuse, type EditResult } from './editResult.js'
import { TYPED_COUNTS } from './settings.js'

/** Far above any real team's pace in one period; keeps typos like 1000000 out of the forecast. */
export const MAX_TICKETS_PER_WEEK = 1000

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
          ...typedCountsNotes(saved),
          ...warnings(saved, today).map(({ input, message, beside }) => ({ input, message: beside ?? message })),
        ]
      : [],
  }
}

/** What the EM must enter before the milestone can be forecast; only a milestone kept from before the MVP lacks any. */
export function inputProblems(inputs: MilestoneInputs): InputNote[] {
  return [
    ...(inputs.startDate === undefined ? [{ input: 'startDate', message: 'No start date is saved yet.' } as const] : []),
    ...(inputs.ticketsRemaining === undefined
      ? [{ input: 'ticketsRemaining', message: 'Enter how many tickets are left.' } as const]
      : []),
    ...(inputs.paceMode === 'range' && inputs.paceRange === undefined
      ? [{ input: 'pace', message: 'Enter a pace range.' } as const]
      : []),
  ]
}

/** A milestone with every input its forecast needs. */
export type ForecastableInputs = MilestoneInputs & { startDate: string; ticketsRemaining: number }

/** Whether the milestone can be forecast: whether nothing stops it, by the same test as `inputProblems`. */
export function isForecastable(inputs: MilestoneInputs): inputs is ForecastableInputs {
  return inputProblems(inputs).length === 0
}

/**
 * Why the typed counts in use are too few to forecast from, or undefined if they aren't in use or are enough: one
 * count isn't a pace.
 */
export function typedCountsShort(inputs: MilestoneInputs): InputNote | undefined {
  if (inputs.paceMode !== 'counts' || inputs.paceCounts.length >= TYPED_COUNTS.forForecast) return undefined
  const entered = counted(inputs.paceCounts.length, periodName(inputs.cadenceDays))
  return {
    input: 'pace',
    message: `Typed counts: ${entered} entered. The forecast needs at least ${TYPED_COUNTS.forForecast}. Add another count, or switch pace to the range.`,
  }
}

function typedCountsNotes(inputs: MilestoneInputs): InputNote[] {
  const short = typedCountsShort(inputs)
  return short ? [short] : []
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
      message: `Typed counts: ${counted(entered, periodName(inputs.cadenceDays))} entered. The forecast needs ${TYPED_COUNTS.reliable} to be reliable.`,
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
  switch (edit.kind) {
    case 'setMilestone': {
      const name = edit.name.trim()
      if (name === '') return refuse('Give the milestone a name.')
      if (!isCalendarDate(edit.startDate.trim())) return refuse('Enter the start date as a calendar date.')
      const tickets = wholeNumber(edit.ticketsRemaining)
      if (tickets === undefined) return refuse('Enter tickets remaining as a whole number, 0 or more.')
      if (tickets > MAX_TICKETS_REMAINING) return refuse(`Enter at most ${MAX_TICKETS_REMAINING} tickets remaining.`)
      storage.saveMilestoneInputs({
        ...(saved ?? newMilestone(teamId)),
        name,
        startDate: edit.startDate.trim(),
        ticketsRemaining: tickets,
      })
      return { ok: true }
    }
    case 'setPaceRange': {
      if (!saved) return refuse('Enter the milestone first.')
      const [low, high] = [wholeNumber(edit.low), wholeNumber(edit.high)]
      if (low === undefined || high === undefined) return refuse('Enter whole numbers of tickets, 0 or more.')
      if (high > MAX_TICKETS_PER_WEEK) {
        return refuse(`Enter at most ${MAX_TICKETS_PER_WEEK} tickets per ${periodName(saved.cadenceDays)}.`)
      }
      if (low > high) return refuse('The low end must not be above the high end.')
      storage.saveMilestoneInputs({ ...saved, paceRange: { low, high } })
      return { ok: true }
    }
    case 'setAmbiguity': {
      if (!saved) return refuse('Enter the milestone first.')
      const level = AMBIGUITIES.find((ambiguity) => ambiguity === edit.level)
      if (level === undefined) return refuse('Choose low, medium or high ambiguity.')
      storage.saveMilestoneInputs({ ...saved, ambiguity: level })
      return { ok: true }
    }
    case 'setPaceCounts':
    case 'addPaceCount': {
      if (!saved) return refuse('Enter the milestone first.')
      const typed = edit.kind === 'addPaceCount' ? [edit.count] : edit.counts.split(/[\s,]+/).filter((count) => count !== '')
      const counts = typed.map(wholeNumber)
      if (!counts.every((count) => count !== undefined)) return refuse('Enter typed counts as whole numbers of tickets, 0 or more.')
      if (counts.some((count) => count > MAX_TICKETS_PER_WEEK)) {
        return refuse(`Enter at most ${MAX_TICKETS_PER_WEEK} tickets per ${periodName(saved.cadenceDays)}.`)
      }
      const paceCounts = edit.kind === 'addPaceCount' ? [...saved.paceCounts, ...counts] : counts
      storage.saveMilestoneInputs({ ...saved, paceCounts })
      return { ok: true }
    }
    case 'removeLastPaceCount': {
      if (!saved) return refuse('Enter the milestone first.')
      storage.saveMilestoneInputs({ ...saved, paceCounts: saved.paceCounts.slice(0, -1) })
      return { ok: true }
    }
    case 'setPaceMode': {
      if (!saved) return refuse('Enter the milestone first.')
      const paceMode = PACE_MODES.find((mode) => mode === edit.paceMode)
      if (paceMode === undefined) return refuse('Choose the range or typed counts.')
      storage.saveMilestoneInputs({ ...saved, paceMode })
      return { ok: true }
    }
    case 'setCadence': {
      if (!saved) return refuse('Enter the milestone first.')
      const days = wholeNumber(edit.cadenceDays)
      if (days === undefined || days < 1) return refuse('Enter the cadence as a whole number of days, 1 or more.')
      if (days > MAX_CADENCE_DAYS) return refuse(`Enter a cadence of at most ${MAX_CADENCE_DAYS} days.`)
      storage.saveMilestoneInputs({ ...saved, cadenceDays: days })
      return { ok: true }
    }
  }
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
