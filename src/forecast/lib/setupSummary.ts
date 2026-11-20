import type { Connection } from '../../model/connection.js'
import type { MilestoneQuery } from '../../model/milestoneQuery.js'
import type { FailedRead } from '../../model/readFailures.js'
import type { SavedRead } from '../../model/savedRead.js'
import type { SetupStorage, TeamQueries } from '../../storage/storage.js'
import { KIND_NAMES } from './choiceLists.js'
import { LEAF_NOTE } from './queryStep.js'
import { readFlag, rejectionOf } from './readSaid.js'
import { chipsShow } from './stepQueryEdit.js'
import { readSince } from './setupReads.js'
import { COMPARABLE_WORK, hasQuery, MILESTONE_QUERY, type StepQuery } from './stepQuery.js'
import { readOn } from './calendarDate.js'
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
  /** Once beneath the rows, when a read by hand leaves a row of several picks without their counts (`COUNTS_WAIT`). */
  countsWait?: string
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
export type SummaryReading = TeamQueries & { setup: Pick<SetupStorage, 'readFailures'>; timeZone: string }

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
  const milestone = rowOf(reading, teamId, tracker, saved ?? { picks: [], query: '' })
  const comparableRow = hasQuery(comparable) ? rowOf(reading, teamId, tracker, comparable) : undefined
  return {
    kind: 'summary',
    tracker: tracker.name,
    where: tracker.where(connection),
    ...(read && { readOn: readOn(read.readAt, reading.timeZone) }),
    milestone: milestone.row,
    ...(comparableRow && { comparable: comparableRow.row }),
    ...((milestone.countsWait || comparableRow?.countsWait) && { countsWait: COUNTS_WAIT }),
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
 * a step's query (`of`), its own read failed, else each of its several picks whose own read at Check failed (a lone
 * pick is its query, never read on its own), or none.
 */
function failedFlags(reading: SummaryReading, teamId: string, connection: Connection) {
  const { whole, queries = {}, picks: pickFailures = {} } = reading.setup.readFailures(teamId) ?? {}
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
      const several = savedQuery.picks.length > 1 && chipsShow(trackerOf(connection), savedQuery)
      const picks = several ? savedQuery.picks.filter(({ query }) => since(pickFailures[query], query)) : []
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

/**
 * A query's row: its picks with their kinds and counts when the picker shows it as their chips, else the query as
 * written; and whether its counts wait for Check, a read by hand having read the query since some of several picks.
 */
function rowOf(reading: SummaryReading, teamId: string, tracker: TrackerFacts, saved: MilestoneQuery): { row: SummaryRow; countsWait: boolean } {
  if (!chipsShow(tracker, saved)) return { row: { query: saved.query }, countsWait: false }
  const queryRead = reading.reads.savedRead({ teamId, query: saved.query })
  const picks = saved.picks.map(({ name, kind, query }) => {
    const pickRead = reading.reads.savedRead({ teamId, query })
    const count = queryRead && pickCount(pickRead, queryRead)
    return {
      pick: { name, kind: KIND_NAMES[kind].name, ...(count !== undefined && { count }) },
      readBefore: queryRead !== undefined && pickRead !== undefined && !readSince(pickRead, queryRead),
    }
  })
  // a read by hand reads the query, not each of several picks, so their counts wait for Check
  return { row: { picks: picks.map(({ pick }) => pick) }, countsWait: picks.length > 1 && picks.some(({ readBefore }) => readBefore) }
}

/** Why a row of several picks shows them without their counts: a read by hand reads each query whole; Check reads each pick. */
const COUNTS_WAIT = 'Read again reads each query whole, so the picks show no counts. Change, then Check, counts each pick again.'

/**
 * A pick's count: the tickets its own read matched, open and finished. A lone pick's read is its query's. None for a
 * pick not read since its query was (its count could be of other picks than these), nor for one read in part.
 */
function pickCount(pickRead: SavedRead | undefined, queryRead: SavedRead): number | undefined {
  if (!readSince(pickRead, queryRead) || pickRead.incomplete) return undefined
  return pickRead.tickets.length
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
const KEYCHAIN_UNUSED =
  'This computer’s keychain couldn’t be used, so nothing was read and the last read stays in use. Check it’s unlocked and that the Forecaster may use it, then try again.'
