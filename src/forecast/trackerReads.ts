import type { Connecting } from './connection.js'
import { ticketsRemaining } from './finished.js'
import { trackerOf } from './trackers.js'

/**
 * What the Inputs screen and the forecast read of the team's tracker, in the local server build: its connection, its
 * queries and their saved reads, and the EM's time zone (an IANA name), which reads are dated in. The browser build
 * has none, so its views are the MVP's.
 */
export type TrackerReads = Pick<Connecting, 'connections' | 'milestoneQueries' | 'reads'> & { timeZone: string }

/** How a view is read beyond what `Storage` keeps: with the team's tracker reads, in the local server build. */
export interface ReadingTracker {
  tracker?: TrackerReads | undefined
}

/** What the team's tracker measures, from its saved reads: what each value following it is, and what a typed one is compared with. */
export interface Measured {
  /** The connected tracker, as the screens name it: GitHub or Jira. */
  tracker: string
  /** The milestone query's latest read, as tickets remaining; none until the query is read. */
  ticketsRemaining: TicketsReading | undefined
}

/** The tracker's reading of tickets remaining: the milestone query's open tickets when it was read. */
export interface TicketsReading {
  count: number
  /** The tracker didn't return every ticket the query matched, so `count` is part of them, never used as if whole. */
  incomplete: boolean
  /** When it was read, in the EM's time zone: "4 Nov 09:12". */
  readOn: string
}

/** Seam B, behind the views: what the team's tracker measures; none with no connection, nor in the browser build. */
export function measured(reads: TrackerReads | undefined, teamId: string): Measured | undefined {
  const connection = reads?.connections.connection(teamId)
  if (!reads || !connection) return undefined
  const query = reads.milestoneQueries.milestoneQuery(teamId)?.query
  const read = query ? reads.reads.savedRead({ teamId, query }) : undefined
  return {
    tracker: trackerOf(connection).name,
    ticketsRemaining: read && { count: ticketsRemaining(read), incomplete: read.incomplete, readOn: readOn(read.readAt, reads.timeZone) },
  }
}

/** A UTC instant as the screens date a read, in `timeZone`: "4 Nov 09:12". */
function readOn(instant: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const part = (type: Intl.DateTimeFormatPartTypes): string => format.formatToParts(new Date(instant)).find((each) => each.type === type)?.value ?? ''
  return `${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`
}
