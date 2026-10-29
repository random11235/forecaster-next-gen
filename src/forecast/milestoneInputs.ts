import type { ThroughputRange } from '../engine/index.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { periodName } from './cadence.js'
import { isCalendarDate } from './calendarDate.js'
import { refuse, type EditResult } from './editResult.js'

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
  /** Whole days in one of the team's periods, 1 or more. */
  | { kind: 'setCadence'; cadenceDays: string }

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
  /** Days in one of the team's periods, which pace is entered in. */
  cadenceDays: number
  paceRange: ThroughputRange | undefined
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
    cadenceDays: inputs.cadenceDays,
    paceRange: inputs.paceRange,
    notes: saved ? [...inputProblems(saved), ...inputWarnings(saved)] : [],
  }
}

/** What the EM must enter before the milestone can be forecast; only a milestone kept from before the MVP lacks any. */
export function inputProblems(inputs: MilestoneInputs): InputNote[] {
  return [
    ...(inputs.startDate === undefined ? [{ input: 'startDate', message: 'No start date is saved yet.' } as const] : []),
    ...(inputs.ticketsRemaining === undefined
      ? [{ input: 'ticketsRemaining', message: 'Enter how many tickets are left.' } as const]
      : []),
    ...(inputs.paceRange === undefined ? [{ input: 'pace', message: 'Enter a pace range.' } as const] : []),
  ]
}

/** A milestone with every input its forecast needs. */
export type ForecastableInputs = MilestoneInputs & { startDate: string; ticketsRemaining: number; paceRange: ThroughputRange }

/** Whether the milestone can be forecast: whether nothing stops it, by the same test as `inputProblems`. */
export function isForecastable(inputs: MilestoneInputs): inputs is ForecastableInputs {
  return inputProblems(inputs).length === 0
}

/** Inputs that can be forecast but give a forecast the EM should question. */
export function inputWarnings(inputs: MilestoneInputs): InputNote[] {
  const workLeft = (inputs.ticketsRemaining ?? 0) > 0
  if (workLeft && inputs.paceRange?.high === 0) {
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
