import type { Failure } from '../../connectors/connector.js'
import type { Connection } from '../../model/connection.js'
import type { SavedRead } from '../../model/savedRead.js'
import { ticketsRemaining, weeksRead } from '../finished.js'
import type { StepQuery } from '../stepQuery.js'
import { trackerOf } from '../trackers.js'

// What a query step says of its query's read: its line, its flag, and why the tracker rejected the query.

/** A read's line: its open tickets, when they count, and those finished in the weeks it reads back. */
export function readLine(read: SavedRead, { kind }: StepQuery): string {
  const finished = `${read.tickets.length - ticketsRemaining(read)} finished in the last ${weeksRead(read)} weeks`
  return kind === 'milestoneQuery' ? `${ticketsRemaining(read)} open · ${finished}` : finished
}

/**
 * A read's flag: incomplete, asking to narrow the query; or, for the milestone query, whose open tickets count, matching nothing.
 * None for a read with all its tickets. Whether comparable work's is used is its pace's to flag (`comparableWorkPace`),
 * over the periods pace counts.
 */
export function readFlag(read: SavedRead, trackerName: string, { picksOut, kind }: StepQuery): { flag: string } | undefined {
  if (read.incomplete) {
    return { flag: `${trackerName} gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.` }
  }
  if (kind === 'milestoneQuery' && read.tickets.length === 0) {
    return { flag: `This query matches nothing: no open tickets, and none finished in the last ${weeksRead(read)} weeks. Check it picks out ${picksOut}.` }
  }
  return undefined
}

/**
 * Why the tracker's failure to read a query rejects it, worded for the Milestone step: it reaches outside the
 * connection, or the tracker refused it, in its own words. None for a failure that says nothing of the query.
 */
export function rejectionOf(connection: Connection, failure: Failure): string | undefined {
  const tracker = trackerOf(connection)
  if (failure.failure === 'outOfScope') return tracker.outOfScope(connection)
  if (failure.failure === 'invalidQuery') return `${tracker.name} rejected this query: ${failure.message}`
  return undefined
}
