import type { Failure } from '../connectors/connector.js'
import type { Connection } from '../model/connection.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead } from '../model/savedRead.js'
import { teamConnection, type Connecting } from './connection.js'
import { finishedSinceFor, readQuery, weeksRead } from './finished.js'
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
 * What is wrong with a query's saved read, and which query's it is (by its step's `kind`); or, with no query named, why
 * a read just asked for failed as a whole, the saved reads staying in use. `change: 'connect'` offers Change, opening
 * the Connect step, for a token or repo the tracker refused.
 */
export interface SummaryFlag {
  of?: StepQuery['kind']
  flag: string
  change?: 'connect'
}

/** What the summary reads: the saved queries and their reads, dated in the EM's time zone. */
export type SummaryReading = Pick<Connecting, 'milestoneQueries' | 'reads'> & { timeZone: string }

/** Whether a step's query is saved, and not left empty by removing its last pick or starting afresh. */
export const hasQuery = (saved: MilestoneQuery | undefined): saved is MilestoneQuery => (saved?.query ?? '') !== ''

/**
 * The summary of the team's setup, done, on `connection`: its tracker and where it reads, when the milestone query
 * was last read, a row for each query, and only problem flags, from the saved queries and reads alone.
 */
export function summaryOf(reading: SummaryReading, teamId: string, connection: Connection): SetupSummary {
  const tracker = trackerOf(connection)
  const saved = reading.milestoneQueries.milestoneQuery(teamId)
  const read = saved && reading.reads.savedRead({ teamId, query: saved.query })
  const comparable = reading.milestoneQueries.comparableWorkQuery(teamId)
  const comparableRead = hasQuery(comparable) ? reading.reads.savedRead({ teamId, query: comparable.query }) : undefined
  return {
    kind: 'summary',
    tracker: tracker.name,
    where: tracker.where(connection),
    ...(read && { readOn: readOn(read.readAt, reading.timeZone) }),
    milestone: rowOf(reading, teamId, tracker, saved ?? { picks: [], query: '' }),
    ...(hasQuery(comparable) && { comparable: rowOf(reading, teamId, tracker, comparable) }),
    note: LEAF_NOTE,
    flags: [...flagOf(read, tracker.name, MILESTONE_QUERY), ...flagOf(comparableRead, tracker.name, COMPARABLE_WORK)],
  }
}

/**
 * What is wrong with a query's saved read, as its step says it (`readFlag`): incomplete, or the milestone's matching
 * nothing; or comparable work's finishing nothing, so pace is the milestone's own. None for a read that is fine, or none.
 */
function flagOf(read: SavedRead | undefined, trackerName: string, stepQuery: StepQuery): SummaryFlag[] {
  if (!read) return []
  const unused = stepQuery.kind === 'comparableWork' && !read.tickets.some((ticket) => ticket.finishedAt !== undefined)
  const flag = readFlag(read, trackerName, stepQuery)?.flag ?? (unused ? comparableUnused(read) : undefined)
  return flag === undefined ? [] : [{ of: stepQuery.kind, flag }]
}

/** Comparable work's read finishing nothing: "…nothing finished in the last 9 weeks, so pace comes from the milestone’s own tickets…". */
function comparableUnused(read: SavedRead): string {
  return `This query matches nothing finished in the last ${weeksRead(read)} weeks, so pace comes from the milestone’s own tickets. Check it picks out ${COMPARABLE_WORK.picksOut}.`
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
      if (!readSince(reads.savedRead({ teamId, query }), queryRead)) await readQuery(connector, reads, { teamId, query, finishedSince, readAt })
    }
  }
}

/** What a read by hand reads and saves with: what a query step reads with, and the EM's time zone, which the summary is dated in. */
export type ReadingAgain = StepReading & { timeZone: string }

/**
 * A read by hand: made (`read`); nothing read, setup not being done (`unchanged`); or failed, a read or more, with the
 * summary saying why (`failed`), the saved read staying in use wherever one failed.
 */
export type ReadAgainSubmitted = { kind: 'read' } | { kind: 'unchanged' } | { kind: 'failed'; view: SetupSummary }

/**
 * Seam B: reads the milestone query again, and comparable work's when it has one, as at `readAt`, as far back as the
 * milestone's inputs need (`finishedSinceFor`); values following the tracker take each new read, typed ones stay as
 * typed, and each of several picks is read again for its count (`readPicks`). Read only once setup is done. A read
 * that fails saves nothing, so its saved read stays in use, and the summary to show says why: for the tracker
 * unreachable or rate-limited, or the token or repo refused (offering Change), once, reading no further; for a query
 * the tracker now rejects or that reaches outside the connection, as that query's flag, the other still read.
 */
export async function submitReadAgain(reading: ReadingAgain, teamId: string, readAt: string): Promise<ReadAgainSubmitted> {
  if (reading.setup.setupClosed(teamId) !== 'done') return { kind: 'unchanged' }
  const connected = await teamConnection(reading, teamId)
  if (!connected) return { kind: 'unchanged' }
  const { connection, connector } = connected
  const failed = (flags: SummaryFlag[]): ReadAgainSubmitted => ({ kind: 'failed', view: { ...summaryOf(reading, teamId, connection), flags } })
  if (connector === 'keychainFailed') return failed([{ flag: KEYCHAIN_UNUSED }])
  const finishedSince = finishedSinceFor(readAt, reading.milestoneInputs.milestoneInputs(teamId))
  const flags: SummaryFlag[] = []
  for (const stepQuery of [MILESTONE_QUERY, COMPARABLE_WORK]) {
    const query = stepQuery.saved(reading.milestoneQueries, teamId)?.query
    if (!query) continue
    const read = await readQuery(connector, reading.reads, { teamId, query, finishedSince, readAt })
    if (read.ok) continue
    const rejection = rejectionOf(connection, read)
    if (rejection === undefined) return failed([failedRead(connection, read)])
    flags.push({ of: stepQuery.kind, flag: rejection })
  }
  // a pick shows its count only while its own read is as new as its query's, so several picks are read again too
  await readPicks(reading, teamId, readAt)
  return flags.length === 0 ? { kind: 'read' } : failed(flags)
}

/** Why a read by hand failed as a whole, the saved reads staying in use: the tracker unreachable or rate-limited, or the token or repo refused. */
function failedRead(connection: Connection, { failure }: Failure): SummaryFlag {
  const tracker = trackerOf(connection)
  switch (failure) {
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
