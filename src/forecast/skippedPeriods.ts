import type { Storage } from '../storage/storage.js'
import { periodName } from './cadence.js'
import { isCalendarDate } from './calendarDate.js'
import { teamConnection } from './connection.js'
import { finishedSinceFor, readQuery } from './finished.js'
import { inputsView, type Submitted } from './inputs.js'
import type { StepReading } from './queryStep.js'
import type { ForecastSettings } from './settings.js'
import { throughDraft } from './throughDraft.js'

/**
 * What skipping reads and saves: what a query step reads with, the milestone's inputs held in the whole of what is
 * stored, which a refused skip's Inputs screen is shown from.
 */
export interface Skipping extends StepReading {
  milestoneInputs: Storage
}

/** Skip tracker periods, or count skipped ones again: each by the date it starts on. */
export type SkipEdit = { kind: 'skip'; periods: string[] } | { kind: 'countAgain'; periods: string[] }

/**
 * When a skip is submitted: `readAt`, the instant a read it needs is made at; `today`, and the EM's time zone (an IANA
 * name), which a refused skip's Inputs screen is dated in, its notes judged against `settings`.
 */
export interface SkipAt {
  settings: ForecastSettings
  today: string
  readAt: string
  timeZone: string
}

/**
 * Seam B: skips the milestone's tracker periods, or counts skipped ones again, keeping pace on the tracker; saved, the
 * Inputs screen comes next. Skips belong to the milestone, so they outlast reads. A skip reads the pace's queries
 * again, as at `readAt`, where their saved reads don't reach back past the skipped periods (`finishedSinceFor`), so
 * the window can keep up to 8 counted; a read that fails leaves the last one in use. While setup is open, the steps'
 * queries are read back too, into its draft, so Check counts the same window the forecast will. Refused, with no
 * period, a period that isn't a date, or no milestone, nothing changes, and the Inputs screen is shown again saying
 * why.
 */
export async function submitSkip(skipping: Skipping, teamId: string, edit: SkipEdit, at: SkipAt): Promise<Submitted> {
  const saved = skipping.milestoneInputs.milestoneInputs(teamId)
  if (!saved) return refused(skipping, teamId, at, 'Enter the milestone first.')
  if (edit.periods.length === 0 || !edit.periods.every(isCalendarDate)) {
    return refused(skipping, teamId, at, `Choose a ${periodName(saved.cadenceDays)} to ${edit.kind === 'skip' ? 'skip' : 'count again'}.`)
  }
  const before = saved.paceWindow.skippedPeriods
  const skippedPeriods = edit.kind === 'skip' ? [...new Set([...before, ...edit.periods])].sort() : before.filter((start) => !edit.periods.includes(start))
  const inputs = { ...saved, paceWindow: { ...saved.paceWindow, skippedPeriods } }
  skipping.milestoneInputs.saveMilestoneInputs(inputs)
  if (edit.kind === 'skip') {
    const finishedSince = finishedSinceFor(at.readAt, inputs)
    await reachBackPast(skipping, teamId, finishedSince, at.readAt)
    // the steps' queries and reads too, while setup holds its own in its draft
    if (skipping.setup.setupState(teamId).open) await reachBackPast(throughDraft(skipping), teamId, finishedSince, at.readAt)
  }
  return { saved: true, next: 'inputs' }
}

/** A refused skip: the Inputs screen again, as saved, saying why beside the tracker's pace. */
function refused(skipping: Skipping, teamId: string, { settings, today, timeZone }: SkipAt, error: string): Submitted {
  const view = inputsView(skipping.milestoneInputs, teamId, settings, today, { tracker: { ...skipping, timeZone } })
  return { saved: false, screen: 'inputs', view: { ...view, refusal: { form: 'paceSkip', error } } }
}

/** Reads the pace's queries again, the milestone query and comparable work's, where their reads reach less far back than `finishedSince`. */
async function reachBackPast(skipping: Skipping, teamId: string, finishedSince: string, readAt: string): Promise<void> {
  const queries = [skipping.milestoneQueries.milestoneQuery(teamId)?.query, skipping.milestoneQueries.comparableWorkQuery(teamId)?.query]
  const short = queries.filter((query): query is string => {
    if (!query) return false
    const read = skipping.reads.savedRead({ teamId, query })
    return read === undefined || Date.parse(read.finishedSince) > Date.parse(finishedSince)
  })
  if (short.length === 0) return
  const connected = await teamConnection(skipping, teamId)
  if (!connected || connected.connector === 'keychainFailed') return
  for (const query of short) await readQuery(connected.connector, skipping.reads, { teamId, query, finishedSince, readAt })
}
