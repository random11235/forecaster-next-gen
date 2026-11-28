import { periodName } from './cadence.js'
import { isCalendarDate } from './calendarDate.js'
import { inputsView, type InputsView } from './inputs.js'
import type { StepReading } from './queryStep.js'
import { reachBack } from './reachBack.js'
import type { TeamContext } from './teamContext.js'

/**
 * What skipping reads its queries again with: what a query step reads with. The milestone's inputs, saved again with a
 * skip, it reads and saves through the team's storage.
 */
export type Skipping = StepReading

/** Skip tracker periods, or count skipped ones again: each by the date it starts on. */
export type SkipEdit = { kind: 'skip'; periods: string[] } | { kind: 'countAgain'; periods: string[] }

/** A skip saved; or refused, with the Inputs screen to show again, saying why beside the tracker's pace. */
export type SkipSubmitted = { saved: true } | { saved: false; view: InputsView }

/**
 * Seam B: skips the milestone's tracker periods, or counts skipped ones again, keeping pace on the tracker; saved, the
 * Inputs screen comes next. Skips belong to the milestone, so they outlast reads. A skip reads the pace's queries
 * again, as at `at.readAt`, where their saved reads don't reach back past the skipped periods (`reachBack`), so
 * the window can keep up to 8 counted; a read that fails leaves the last one in use. The steps' `current` queries are
 * read back too, so while setup is open its draft's are, into it, and Check counts the same window the forecast will.
 * The milestone's inputs are read and saved, skips and all, through the team's context (`team`), its storage. Refused,
 * with no period, a period that isn't a date, or no milestone, nothing changes, and the Inputs screen is shown again
 * saying why, as `team` shows it.
 */
export async function submitSkip(skipping: Skipping, team: TeamContext, edit: SkipEdit): Promise<SkipSubmitted> {
  const { storage, teamId, at } = team
  const saved = storage.milestoneInputs(teamId)
  if (!saved) return refused(team, 'Enter the milestone first.')
  if (edit.periods.length === 0 || !edit.periods.every(isCalendarDate)) {
    return refused(team, `Choose a ${periodName(saved.cadenceDays)} to ${edit.kind === 'skip' ? 'skip' : 'count again'}.`)
  }
  const before = saved.paceWindow.skippedPeriods
  const skippedPeriods = edit.kind === 'skip' ? [...new Set([...before, ...edit.periods])].sort() : before.filter((start) => !edit.periods.includes(start))
  const inputs = { ...saved, paceWindow: { ...saved.paceWindow, skippedPeriods } }
  storage.saveMilestoneInputs(inputs)
  if (edit.kind === 'skip') await reachBack(skipping, teamId, inputs, at.readAt)
  return { saved: true }
}

/** A refused skip: the Inputs screen again, as saved, saying why beside the tracker's pace. */
function refused(team: TeamContext, error: string): SkipSubmitted {
  const view = inputsView(team)
  return { saved: false, view: { ...view, refusal: { form: 'paceSkip', error } } }
}
