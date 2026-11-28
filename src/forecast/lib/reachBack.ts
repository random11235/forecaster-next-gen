import type { MilestoneInputs } from '../../model/milestoneInputs.js'
import type { TeamQueries } from '../../storage/storage.js'
import { teamConnection, withTeamQueries } from './connection.js'
import { finishedSinceFor, readQuery } from './queryRead.js'
import type { StepReading } from './queryStep.js'

// Reading the pace's queries again, further back, where a change to the milestone's inputs needs their reads to reach further.

/**
 * Reads the pace's queries again, as at `readAt`, the milestone query and comparable work's, where their reads reach
 * less far back than the milestone's `inputs` need (`finishedSinceFor`), as after a skip or a longer cadence: the
 * saved ones, into what's saved; then the steps' (`current`) whose reads still fall short, which while setup is open
 * are the draft's own, into it. A read that fails leaves the last one in use, and a query the saved pass failed to read
 * isn't asked for again.
 */
export async function reachBack(
  reading: StepReading,
  teamId: string,
  inputs: Pick<MilestoneInputs, 'cadenceDays' | 'paceWindow'>,
  readAt: string,
): Promise<void> {
  const finishedSince = finishedSinceFor(readAt, inputs)
  const saved = withTeamQueries(reading, 'saved')
  const current = withTeamQueries(reading, 'current')
  const short = (queries: TeamQueries): string[] => shortOf(queries, teamId, finishedSince)
  if (short(saved).length === 0 && short(current).length === 0) return
  const connected = await teamConnection(reading, teamId)
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
