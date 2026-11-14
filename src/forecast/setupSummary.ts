import type { Connection } from '../model/connection.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { FailedRead } from '../model/readFailures.js'
import type { SavedRead } from '../model/savedRead.js'
import type { SetupStorage } from '../storage/storage.js'
import { teamConnection, type Connecting } from './connection.js'
import { finishedSinceFor, readQuery, type QueryRead } from './finished.js'
import { chipsShow, kindName, LEAF_NOTE, readFlag, rejectionOf, type StepReading } from './queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from './stepQuery.js'
import { throughDraft } from './throughDraft.js'
import { readOn } from './trackerReads.js'
import { trackerOf, type TrackerFacts } from './trackers.js'

/**
 * Setup done: the tracker, the repo or project read, and when the milestone's tickets were last read, if they were;
 * what the milestone query reads, and comparable work's when it has one; the leaf-and-epics line, once; and only
 * what is wrong with those reads.
 */
export interface SetupSummary {
  kind: 'summary'
  tracker: string
  where: string
  /** In the EM's time zone: "4 Nov 09:12". */
  readOn?: string
  milestone: SummaryRow
  /** None without comparable work. */
  comparable?: SummaryRow
  /** "Leaf tickets only. Epics include their sub-epics." */
  note: string
  /** Problem flags only: none for a working setup. */
  flags: SummaryFlag[]
}

/**
 * A summary row: the picks, each named with its kind as the screens name it ("epic", "fix version") and with its count
 * of matches, open and finished, where it has one (`pickCount`); or the query as written by hand, with no counts.
 */
export type SummaryRow = { picks: SummaryPick[] } | { query: string }

/** A pick on a summary row: "#41 Checkout v2 (epic) · 32". */
export interface SummaryPick {
  name: string
  kind: string
  /** The tickets the pick's own query matches; none until it is read whole since its query was. */
  count?: number
}

/**
 * What is wrong with a query's saved read, or why its last read or one of its picks' failed, and which query's it is
 * (by its step's `kind`); or, with no query named, why the last read by hand failed as a whole, the saved reads staying
 * in use. `change: 'connect'` offers Change, opening the Connect step, for a token or repo the tracker refused.
 */
export interface SummaryFlag {
  of?: StepQuery['kind']
  flag: string
  change?: 'connect'
}

/** What the summary reads: the saved queries and their reads, dated in the EM's time zone, and why the last reads failed. */
export type SummaryReading = Pick<Connecting, 'milestoneQueries' | 'reads'> & { setup: Pick<SetupStorage, 'readFailures'>; timeZone: string }

/** Whether a step's query is saved, and not left empty by removing its last pick or starting afresh. */
export const hasQuery = (saved: MilestoneQuery | undefined): saved is MilestoneQuery => (saved?.query ?? '') !== ''

/**
 * The summary of the team's setup, done, on `connection`: its tracker and where it reads, when the milestone query
 * was last read, a row for each query, and only problem flags, from the saved queries and reads and why the last reads
 * failed (`failedFlags`).
 */
export function summaryOf(reading: SummaryReading, teamId: string, connection: Connection): SetupSummary {
  const tracker = trackerOf(connection)
  const saved = reading.milestoneQueries.milestoneQuery(teamId)
  const read = saved && reading.reads.savedRead({ teamId, query: saved.query })
  const comparable = reading.milestoneQueries.comparableWorkQuery(teamId)
  const comparableRead = hasQuery(comparable) ? reading.reads.savedRead({ teamId, query: comparable.query }) : undefined
  const failed = failedFlags(reading, teamId, connection)
  return {
    kind: 'summary',
    tracker: tracker.name,
    where: tracker.where(connection),
    ...(read && { readOn: readOn(read.readAt, reading.timeZone) }),
    milestone: rowOf(reading, teamId, tracker, saved ?? { picks: [], query: '' }),
    ...(hasQuery(comparable) && { comparable: rowOf(reading, teamId, tracker, comparable) }),
    note: LEAF_NOTE,
    flags: [
      ...failed.whole,
      ...(failed.of(MILESTONE_QUERY, saved) ?? flagOf(read, tracker.name, MILESTONE_QUERY)),
      ...(failed.of(COMPARABLE_WORK, comparable) ?? flagOf(comparableRead, tracker.name, COMPARABLE_WORK)),
    ],
  }
}

/**
 * The flags of the team's failed reads that no read has been saved since: a read by hand failed as a whole; and for
 * a step's query (`of`), its own read failed, else each of its picks whose own read at Check failed, or none.
 */
function failedFlags(reading: SummaryReading, teamId: string, connection: Connection) {
  const { whole, queries = {} } = reading.setup.readFailures(teamId) ?? {}
  const since = (failed: FailedRead | undefined, query: string | undefined): failed is FailedRead => {
    const read = query === undefined ? undefined : reading.reads.savedRead({ teamId, query })
    return failed !== undefined && (read === undefined || Date.parse(read.readAt) <= Date.parse(failed.at))
  }
  const saved = reading.milestoneQueries.milestoneQuery(teamId)
  return {
    whole: since(whole, saved?.query) ? [failedRead(connection, whole)] : [],
    of(stepQuery: StepQuery, savedQuery: MilestoneQuery | undefined): SummaryFlag[] | undefined {
      if (!hasQuery(savedQuery)) return undefined
      const failed = queries[savedQuery.query]
      if (since(failed, savedQuery.query)) return [{ ...queryFailedFlag(connection, failed), of: stepQuery.kind }]
      const picks = chipsShow(trackerOf(connection), savedQuery) ? savedQuery.picks.filter(({ query }) => since(queries[query], query)) : []
      return picks.length === 0 ? undefined : picks.map(({ name }) => ({ of: stepQuery.kind, flag: pickFailed(name) }))
    },
  }
}

/** A query's own read failed: rejected or reaching outside the connection, as its step says it; else as a read failing whole. */
function queryFailedFlag(connection: Connection, failed: FailedRead): SummaryFlag {
  const rejection = failed.failure === 'keychainFailed' ? undefined : rejectionOf(connection, failed)
  return rejection === undefined ? failedRead(connection, failed) : { flag: rejection }
}

/** A pick whose own read at Check failed: "#57 Search revamp couldn’t be read on its own, so it shows no count…". */
const pickFailed = (name: string) => `${name} couldn’t be read on its own, so it shows no count. Change, then Check, reads it again.`

/**
 * What is wrong with a query's saved read, as its step says it (`readFlag`): incomplete, or the milestone's matching
 * nothing. None for a read that is fine, or none.
 */
function flagOf(read: SavedRead | undefined, trackerName: string, stepQuery: StepQuery): SummaryFlag[] {
  const flag = read && readFlag(read, trackerName, stepQuery)?.flag
  return flag === undefined ? [] : [{ of: stepQuery.kind, flag }]
}

/** A query's row: its picks with their kinds and counts when the picker shows it as their chips, else the query as written. */
function rowOf(reading: SummaryReading, teamId: string, tracker: TrackerFacts, saved: MilestoneQuery): SummaryRow {
  if (!chipsShow(tracker, saved)) return { query: saved.query }
  const queryRead = reading.reads.savedRead({ teamId, query: saved.query })
  return {
    picks: saved.picks.map(({ name, kind, query }) => {
      const count = queryRead && pickCount(reading.reads.savedRead({ teamId, query }), queryRead)
      return { name, kind: kindName(kind), ...(count !== undefined && { count }) }
    }),
  }
}

/**
 * A pick's count: the tickets its own read matched, open and finished. A lone pick's read is its query's. None for a
 * pick not read since its query was (its count could be of other picks than these), nor for one read in part.
 */
function pickCount(pickRead: SavedRead | undefined, queryRead: SavedRead): number | undefined {
  if (!readSince(pickRead, queryRead) || pickRead.incomplete) return undefined
  return pickRead.tickets.length
}

/** Whether a pick has a read made since its query's: none older than it. */
function readSince(pickRead: SavedRead | undefined, queryRead: SavedRead): pickRead is SavedRead {
  return pickRead !== undefined && Date.parse(pickRead.readAt) >= Date.parse(queryRead.readAt)
}

/**
 * Seam B, at Check: reads, as at `readAt`, each pick of the milestone query and of comparable work's that has no read
 * since its query's, saving it, so the summary can give each pick its count. Ticket reads say nothing of which pick
 * matched them, so a query of several picks needs one read per pick; a lone pick's read is its query's, and comparable
 * work's picks are read when picked, so neither is read again. A query written by hand has no picks to read; a read
 * that fails leaves that pick without its count. The steps' draft is read from and saved into, as the steps are.
 */
export async function readPicks(reading: StepReading, teamId: string, readAt: string): Promise<void> {
  const connected = await teamConnection(reading, teamId)
  if (!connected || connected.connector === 'keychainFailed') return
  const { connection, connector } = connected
  // setup is open at Check, so the picks' reads are held in its draft, with the queries they are of, until "Use these"
  const { milestoneQueries, reads, milestoneInputs } = throughDraft(reading)
  const finishedSince = finishedSinceFor(readAt, milestoneInputs.milestoneInputs(teamId))
  for (const saved of [milestoneQueries.milestoneQuery(teamId), milestoneQueries.comparableWorkQuery(teamId)]) {
    if (!hasQuery(saved) || !chipsShow(trackerOf(connection), saved)) continue
    const queryRead = reads.savedRead({ teamId, query: saved.query })
    if (!queryRead) continue
    for (const { query } of saved.picks) {
      if (readSince(reads.savedRead({ teamId, query }), queryRead)) continue
      const read = await readQuery(connector, reads, { teamId, query, finishedSince, readAt })
      keepFailed(reading.setup, teamId, { queries: { [query]: read.ok ? undefined : failedAt(read, readAt) } })
    }
  }
}

/** A failed read's failure, as asked for at `at`, without the saved read it leaves in use. */
function failedAt(read: Extract<QueryRead, { ok: false }>, at: string): FailedRead {
  return read.failure === 'invalidQuery' ? { failure: read.failure, message: read.message, at } : { failure: read.failure, at }
}

/** What changes in why the team's reads failed: each query's failure, or none once read (`undefined`), and the whole's when given. */
type FailedChange = { whole?: FailedRead | undefined; queries?: Record<string, FailedRead | undefined> }

/** Keeps `change` beside why the team's other reads failed; forgets them all once none is left. */
function keepFailed(setup: Pick<SetupStorage, 'readFailures' | 'saveReadFailures' | 'clearReadFailures'>, teamId: string, change: FailedChange): void {
  const kept = setup.readFailures(teamId) ?? {}
  const whole = 'whole' in change ? change.whole : kept.whole
  const queries = Object.fromEntries(Object.entries({ ...kept.queries, ...change.queries }).filter((entry): entry is [string, FailedRead] => entry[1] !== undefined))
  if (whole === undefined && Object.keys(queries).length === 0) setup.clearReadFailures(teamId)
  else setup.saveReadFailures(teamId, { ...(whole && { whole }), ...(Object.keys(queries).length > 0 && { queries }) })
}

/** What a read by hand reads and saves with: what a query step reads with, and the EM's time zone, which the summary is dated in. */
export type ReadingAgain = StepReading & { timeZone: string }

/**
 * A read by hand: made (`read`); nothing read, setup not being done (`unchanged`); or failed, a read or more, the
 * summary saying why from then on (`failed`), the saved read staying in use wherever one failed.
 */
export type ReadAgainSubmitted = { kind: 'read' | 'unchanged' | 'failed' }

/**
 * Seam B: reads the milestone query again, and comparable work's when it has one, as at `readAt`, as far back as the
 * milestone's inputs need (`finishedSinceFor`); values following the tracker take each new read, typed ones stay as
 * typed. Each of several picks is read at Check alone (`readPicks`), so its count shows none until then, its read now
 * older than its query's. Read only once setup is done. A read that fails saves nothing, so its saved read stays in
 * use, and why is kept, so the summary says it until a read is saved after it: for the tracker unreachable or
 * rate-limited, or the token or repo refused (offering Change), once, reading no further; for a query the tracker now
 * rejects or that reaches outside the connection, as that query's flag, the other still read.
 */
export async function submitReadAgain(reading: ReadingAgain, teamId: string, readAt: string): Promise<ReadAgainSubmitted> {
  if (reading.setup.setupClosed(teamId) !== 'done') return { kind: 'unchanged' }
  const connected = await teamConnection(reading, teamId)
  if (!connected) return { kind: 'unchanged' }
  const { connection, connector } = connected
  if (connector === 'keychainFailed') return (keepFailed(reading.setup, teamId, { whole: { failure: 'keychainFailed', at: readAt } }), { kind: 'failed' })
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

/**
 * Why a read failed as a whole, the saved reads staying in use: the tracker unreachable or rate-limited, the token or
 * repo refused, or this computer's keychain not giving the token.
 */
function failedRead(connection: Connection, { failure }: FailedRead): SummaryFlag {
  const tracker = trackerOf(connection)
  switch (failure) {
    case 'keychainFailed':
      return { flag: KEYCHAIN_UNUSED }
    case 'unauthorised':
      return { flag: tracker.refused(connection), change: 'connect' }
    case 'notFound':
      return { flag: tracker.notFound(connection), change: 'connect' }
    default:
      return { flag: `${tracker.name} can’t be reached just now, or is limiting requests, so the last read stays in use. Try again in a few minutes.` }
  }
}

/** Why a read by hand read nothing, when this computer's keychain couldn't give the token. */
const KEYCHAIN_UNUSED = 'This computer’s keychain couldn’t be used, so nothing was read and the last read stays in use. Check it’s unlocked and that the Forecaster may use it, then try again.'
