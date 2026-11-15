import type { FailedRead, FailedReads, ReadFailures } from '../model/readFailures.js'
import type { SavedRead } from '../model/savedRead.js'
import type { SetupStorage } from '../storage/storage.js'
import { teamConnection } from './connection.js'
import { finishedSinceFor, readQuery, type QueryRead } from './finished.js'
import { chipsShow, rejectionOf, type StepReading } from './queryStep.js'
import { COMPARABLE_WORK, hasQuery, MILESTONE_QUERY } from './stepQuery.js'
import { redrafted, throughDraft } from './throughDraft.js'
import { trackerOf } from './trackers.js'

// Setup's own reads of the tracker: each pick's at Check, and the queries' by hand from the summary (Read again).

/** Whether a pick has a read made since its query's: none older than it. */
export function readSince(pickRead: SavedRead | undefined, queryRead: SavedRead): pickRead is SavedRead {
  return pickRead !== undefined && Date.parse(pickRead.readAt) >= Date.parse(queryRead.readAt)
}

/**
 * At Check, reads, as at `readAt`, each pick of the milestone query and of comparable work's that has no read since
 * its query's, so the summary can give each pick its count. Ticket reads say nothing of which pick matched them, so a
 * query of several picks needs one read per pick; a lone pick's read is its query's, and comparable work's picks are
 * read when picked, so neither is read again. A query written by hand has no picks to read; a read that fails leaves
 * that pick without its count, and why is kept, for the summary. Setup is open at Check, so the queries are the
 * draft's, and the reads, and why one failed, are held in it until "Use these".
 */
export async function readPicks(reading: StepReading, teamId: string, readAt: string): Promise<void> {
  if (!reading.setup.setupState(teamId).open) return
  const connected = await teamConnection(reading, teamId)
  if (!connected || connected.connector === 'keychainFailed') return
  const { connection, connector } = connected
  const { milestoneQueries, reads, milestoneInputs, setup } = throughDraft(reading)
  const finishedSince = finishedSinceFor(readAt, milestoneInputs.milestoneInputs(teamId))
  for (const saved of [milestoneQueries.milestoneQuery(teamId), milestoneQueries.comparableWorkQuery(teamId)]) {
    if (!hasQuery(saved) || !chipsShow(trackerOf(connection), saved)) continue
    const queryRead = reads.savedRead({ teamId, query: saved.query })
    if (!queryRead) continue
    for (const { query } of saved.picks) {
      if (readSince(reads.savedRead({ teamId, query }), queryRead)) continue
      const read = await readQuery(connector, reads, { teamId, query, finishedSince, readAt })
      const failed = read.ok ? undefined : failedAt(read, readAt)
      redrafted(setup, teamId, ({ pickFailures, ...draft }) => ({ ...draft, ...failuresOrNone('pickFailures', changed(pickFailures, { [query]: failed })) }))
    }
  }
}

/** A failed read's failure, as asked for at `at`, without the saved read it leaves in use. */
function failedAt(read: Extract<QueryRead, { ok: false }>, at: string): FailedRead {
  return read.failure === 'invalidQuery' ? { failure: read.failure, message: read.message, at } : { failure: read.failure, at }
}

/** `failures` with each query in `change` failing as it says, or no longer (`undefined`); none once none is left. */
function changed(failures: FailedReads | undefined, change: Record<string, FailedRead | undefined>): FailedReads | undefined {
  const kept = Object.entries({ ...failures, ...change }).filter((entry): entry is [string, FailedRead] => entry[1] !== undefined)
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
}

/** `failures` under `key`, or the key left out for none, as the storage keeps none. */
const failuresOrNone = <K extends string>(key: K, failures: FailedReads | undefined): Partial<Record<K, FailedReads>> =>
  (failures ? { [key]: failures } : {}) as Partial<Record<K, FailedReads>>

/** Keeps why the team's reads failed, with the whole's (`whole`, kept as it was when not given) and each query's as `queries` changes them. */
function keepFailed(setup: SetupStorage, teamId: string, change: { whole?: FailedRead | undefined; queries: Record<string, FailedRead | undefined> }): void {
  const { whole, queries, picks }: ReadFailures = setup.readFailures(teamId) ?? {}
  const wholeNow = 'whole' in change ? change.whole : whole
  setup.saveReadFailures(teamId, {
    ...(wholeNow && { whole: wholeNow }),
    ...failuresOrNone('queries', changed(queries, change.queries)),
    ...failuresOrNone('picks', picks),
  })
}

/**
 * A read by hand: made (`read`); nothing read, setup not being done (`unchanged`); or failed, a read or more, the
 * summary saying why from then on (`failed`), the saved read staying in use wherever one failed.
 */
export type ReadAgainSubmitted = { kind: 'read' | 'unchanged' | 'failed' }

/**
 * Seam B: reads the milestone query again, and comparable work's when it has one, as at `readAt`, as far back as the
 * milestone's inputs need (`finishedSinceFor`); values following the tracker take each new read, typed ones stay as
 * typed. Each of several picks is read at Check alone (`readPicks`), so its count is from then, its read now older
 * than its query's. Read only once setup is closed done, never while its steps are open, as the summary is shown only
 * then. A read that fails saves nothing, so its saved read stays in use, and why is kept, so the summary says it until
 * a read is saved after it: for the tracker unreachable or rate-limited, or the token or repo refused (offering
 * Change), once, reading no further; for a query the tracker now rejects or that reaches outside the connection, as
 * that query's flag, the other still read.
 */
export async function submitReadAgain(reading: StepReading, teamId: string, readAt: string): Promise<ReadAgainSubmitted> {
  const state = reading.setup.setupState(teamId)
  if (state.open || state.closed !== 'done') return { kind: 'unchanged' }
  const connected = await teamConnection(reading, teamId)
  if (!connected) return { kind: 'unchanged' }
  const { connection, connector } = connected
  if (connector === 'keychainFailed') return (keepFailed(reading.setup, teamId, { whole: { failure: 'keychainFailed', at: readAt }, queries: {} }), { kind: 'failed' })
  const finishedSince = finishedSinceFor(readAt, reading.milestoneInputs.milestoneInputs(teamId))
  // a read made forgets why the last one failed; one failing whole stops there, the queries left as they were
  const queries: Record<string, FailedRead | undefined> = {}
  for (const stepQuery of [MILESTONE_QUERY, COMPARABLE_WORK]) {
    const query = stepQuery.saved(reading.milestoneQueries, teamId)?.query
    if (!query) continue
    const read = await readQuery(connector, reading.reads, { teamId, query, finishedSince, readAt })
    queries[query] = read.ok ? undefined : failedAt(read, readAt)
    if (!read.ok && rejectionOf(connection, read) === undefined) {
      keepFailed(reading.setup, teamId, { whole: failedAt(read, readAt), queries: { ...queries, [query]: undefined } })
      return { kind: 'failed' }
    }
  }
  keepFailed(reading.setup, teamId, { whole: undefined, queries })
  return Object.values(queries).some((failed) => failed !== undefined) ? { kind: 'failed' } : { kind: 'read' }
}
