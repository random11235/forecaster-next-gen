import type { Storage } from '../storage/storage.js'
import { teamConnection, type Connecting } from './connection.js'
import { finishedSinceFor, readQuery } from './finished.js'

/** What skipping reads and saves: the team's connection, queries and reads, and the milestone's inputs. */
export interface Skipping extends Connecting {
  milestoneInputs: Pick<Storage, 'milestoneInputs' | 'saveMilestoneInputs'>
}

/** Skip tracker periods, or count skipped ones again: each by the date it starts on. */
export type SkipEdit = { kind: 'skip'; periods: string[] } | { kind: 'countAgain'; periods: string[] }

/**
 * Seam B: skips the milestone's tracker periods, or counts skipped ones again, keeping pace on the tracker. Skips
 * belong to the milestone, so they outlast reads. A skip reads the pace's queries again, as at `readAt`, where their
 * saved reads don't reach back past the skipped periods (`finishedSinceFor`), so the window can keep up to 8 counted;
 * a read that fails leaves the last one in use. Nothing before the milestone is entered.
 */
export async function submitSkip(skipping: Skipping, teamId: string, edit: SkipEdit, readAt: string): Promise<void> {
  const saved = skipping.milestoneInputs.milestoneInputs(teamId)
  if (!saved) return
  const before = saved.paceWindow.skippedPeriods
  const skippedPeriods = edit.kind === 'skip' ? [...new Set([...before, ...edit.periods])].sort() : before.filter((start) => !edit.periods.includes(start))
  const inputs = { ...saved, paceWindow: { ...saved.paceWindow, skippedPeriods } }
  skipping.milestoneInputs.saveMilestoneInputs(inputs)
  if (edit.kind === 'skip') await reachBackPast(skipping, teamId, finishedSinceFor(readAt, inputs), readAt)
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
