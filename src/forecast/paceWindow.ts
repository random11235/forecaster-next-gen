import type { MilestoneInputs, PaceAction } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { dayMonth, isCalendarDate } from './calendarDate.js'
import type { PeriodName } from './cadence.js'
import { typedCountStarts } from './capacity.js'
import { refuse, type EditResult } from './editResult.js'

/** Counts, oldest first, each period starting on the date at the same place in `starts`. */
export interface DatedCounts {
  counts: number[]
  starts: string[]
}

/** A form on the pace pattern: apply its action, or undo the one applied. */
export type PaceActionEdit = { kind: 'applyPaceAction'; action: string; date: string } | { kind: 'undoPaceAction' }

const PACE_ACTION_EDITS: ReadonlySet<string> = new Set<PaceActionEdit['kind']>(['applyPaceAction', 'undoPaceAction'])

export function isPaceActionEdit(edit: { kind: string }): edit is PaceActionEdit {
  return PACE_ACTION_EDITS.has(edit.kind)
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

/** The counts the pace is drawn from once `action` is applied: those from its period on, or all but its period. */
export function withAction({ counts, starts }: DatedCounts, action: PaceAction): DatedCounts {
  // ISO calendar dates order as strings do
  const kept = (i: number) => (action.kind === 'startFrom' ? starts[i]! >= action.date : starts[i] !== action.date)
  return { counts: counts.filter((_, i) => kept(i)), starts: starts.filter((_, i) => kept(i)) }
}

/** The applied action as a clause: "Counting pace from 12 Oct", "Leaving out the week of 12 Oct". */
export function actionSaid({ kind, date }: PaceAction, period: PeriodName): string {
  return kind === 'startFrom' ? `Counting pace from ${dayMonth(date)}` : `Leaving out the ${period} of ${dayMonth(date)}`
}

/** Seam B, behind `submitInputs`: applies the pace pattern's action to the milestone's pace window, or undoes it. */
export function editPaceAction(storage: Storage, teamId: string, edit: PaceActionEdit): EditResult {
  const saved = storage.milestoneInputs(teamId)
  if (saved === undefined) return refuse('There is no milestone to apply it to.')
  if (edit.kind === 'undoPaceAction') {
    storage.saveMilestoneInputs({ ...saved, paceWindow: { ...saved.paceWindow, action: undefined } })
    return { ok: true }
  }
  if ((edit.action !== 'startFrom' && edit.action !== 'leaveOut') || !isCalendarDate(edit.date.trim())) {
    return refuse('That action is no longer offered.')
  }
  const action: PaceAction = { kind: edit.action, date: edit.date.trim() }
  storage.saveMilestoneInputs({ ...saved, paceWindow: { ...saved.paceWindow, action } })
  return { ok: true }
}
