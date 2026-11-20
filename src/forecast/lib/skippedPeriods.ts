import type { Storage, TeamQueries } from '../../storage/storage.js'
import { periodName } from './cadence.js'
import { isCalendarDate } from './calendarDate.js'
import { teamConnection, withTeamQueries } from './connection.js'
import { finishedSinceFor, readQuery } from './queryRead.js'
import { inputsView, type InputsView } from './inputs.js'
import type { StepReading } from './queryStep.js'
import type { TeamContext } from './teamContext.js'

/** What skipping reads and saves: what a query step reads with, and the milestone's inputs, saved again with a skip. */
export interface Skipping extends StepReading {
  milestoneInputs: Pick<Storage, 'milestoneInputs' | 'saveMilestoneInputs'>
}

/** Skip tracker periods, or count skipped ones again: each by the date it starts on. */
export type SkipEdit = { kind: 'skip'; periods: string[] } | { kind: 'countAgain'; periods: string[] }

/** A skip saved; or refused, with the Inputs screen to show again, saying why beside the tracker's pace. */
export type SkipSubmitted = { saved: true } | { saved: false; view: InputsView }

/**
 * Seam B: skips the milestone's tracker periods, or counts skipped ones again, keeping pace on the tracker; saved, the
 * Inputs screen comes next. Skips belong to the milestone, so they outlast reads. A skip reads the pace's queries
 * again, as at `at.readAt`, where their saved reads don't reach back past the skipped periods (`finishedSinceFor`), so
 * the window can keep up to 8 counted; a read that fails leaves the last one in use. The steps' `current` queries are
 * read back too, so while setup is open its draft's are, into it, and Check counts the same window the forecast will.
 * Refused, with no period, a period that isn't a date, or no milestone, nothing changes, and the Inputs screen is shown
 * again saying why, as the team's context (`team`) shows it.
 */
export async function submitSkip(skipping: Skipping, team: TeamContext, edit: SkipEdit): Promise<SkipSubmitted> {
  const { teamId, at } = team
  const saved = skipping.milestoneInputs.milestoneInputs(teamId)
  if (!saved) return refused(team, 'Enter the milestone first.')
  if (edit.periods.length === 0 || !edit.periods.every(isCalendarDate)) {
    return refused(team, `Choose a ${periodName(saved.cadenceDays)} to ${edit.kind === 'skip' ? 'skip' : 'count again'}.`)
  }
  const before = saved.paceWindow.skippedPeriods
  const skippedPeriods = edit.kind === 'skip' ? [...new Set([...before, ...edit.periods])].sort() : before.filter((start) => !edit.periods.includes(start))
  const inputs = { ...saved, paceWindow: { ...saved.paceWindow, skippedPeriods } }
  skipping.milestoneInputs.saveMilestoneInputs(inputs)
  if (edit.kind === 'skip') {
    const finishedSince = finishedSinceFor(at.readAt, inputs)
    await reachBackPast(skipping, teamId, finishedSince, at.readAt)
  }
  return { saved: true }
}

/** A refused skip: the Inputs screen again, as saved, saying why beside the tracker's pace. */
function refused(team: TeamContext, error: string): SkipSubmitted {
  const view = inputsView(team)
  return { saved: false, view: { ...view, refusal: { form: 'paceSkip', error } } }
}

/**
 * Reads the pace's queries again, the milestone query and comparable work's, where their reads reach less far back than
 * `finishedSince`: the saved ones, into what's saved; then the steps' (`current`) whose reads still fall short, which
 * while setup is open are the draft's own, into it. A query the saved pass failed to read isn't asked for again.
 */
async function reachBackPast(skipping: Skipping, teamId: string, finishedSince: string, readAt: string): Promise<void> {
  const saved = withTeamQueries(skipping, 'saved')
  const current = withTeamQueries(skipping, 'current')
  const short = (queries: TeamQueries): string[] => shortOf(queries, teamId, finishedSince)
  if (short(saved).length === 0 && short(current).length === 0) return
  const connected = await teamConnection(skipping, teamId)
  if (!connected || connected.connector === 'keychainFailed') return
  const failed = new Set<string>()
  for (const query of short(saved)) {
    if (!(await readQuery(connected.connector, saved.reads, { teamId, query, finishedSince, readAt })).ok) failed.add(query)
  }
  for (const query of short(current).filter((each) => !failed.has(each)))
    await readQuery(connected.connector, current.reads, { teamId, query, finishedSince, readAt })
}

/** The team's queries in `queries` whose reads reach less far back than `finishedSince`, or that have none. */
function shortOf({ milestoneQueries, reads }: TeamQueries, teamId: string, finishedSince: string): string[] {
  return [milestoneQueries.milestoneQuery(teamId)?.query, milestoneQueries.comparableWorkQuery(teamId)?.query].filter((query): query is string => {
    if (!query) return false
    const read = reads.savedRead({ teamId, query })
    return read === undefined || Date.parse(read.finishedSince) > Date.parse(finishedSince)
  })
}
