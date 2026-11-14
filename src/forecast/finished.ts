import type { Connector, Failure } from '../connectors/connector.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { SavedRead, TeamQuery } from '../model/savedRead.js'
import { DAY_MS } from '../model/time.js'
import type { SavedReadStorage } from '../storage/storage.js'
import { addDays, daysBetween } from './calendarDate.js'
import { TRACKER_PERIODS, type DatedCounts } from './paceWindow.js'

/**
 * The UTC instant a read made at `readAt` counts finished tickets from: far enough back, in whole weeks, for the
 * `TRACKER_PERIODS` whole periods at the milestone's cadence the tracker's pace counts, the periods the EM skipped among
 * them, and the current one. Weekly with nothing skipped, 9 weeks. With no milestone yet, as weekly.
 */
export function finishedSinceFor(readAt: string, inputs: Pick<MilestoneInputs, 'cadenceDays' | 'paceWindow'> | undefined): string {
  const cadenceDays = inputs?.cadenceDays ?? 7
  const skipped = inputs?.paceWindow.skippedPeriods ?? []
  // a skip counts while it could be in the window: within the reach with every skip counted
  const furthest = addDays(readAt.slice(0, 10), -(TRACKER_PERIODS + skipped.length + 1) * cadenceDays)
  const skips = skipped.filter((start) => start >= furthest).length
  const weeks = Math.ceil(((TRACKER_PERIODS + skips + 1) * cadenceDays) / 7)
  return new Date(Date.parse(readAt) - weeks * 7 * DAY_MS).toISOString()
}

/** How many weeks back the read counts finished tickets: "finished in the last 9 weeks". */
export function weeksRead({ readAt, finishedSince }: Pick<SavedRead, 'readAt' | 'finishedSince'>): number {
  return Math.round((Date.parse(readAt) - Date.parse(finishedSince)) / (7 * DAY_MS))
}

/** A query read and saved; or a failed read, with the read saved before it, which is kept (none if it was never read). */
export type QueryRead = { ok: true; read: SavedRead } | ({ ok: false; saved: SavedRead | undefined } & Failure)

/** A read of one of a team's queries: its tickets open, or finished at or after `finishedSince` (`finishedSinceFor`), read at `readAt`. */
export interface QueryReading extends TeamQuery {
  /** A UTC instant. */
  finishedSince: string
  /** The UTC instant the read is made. */
  readAt: string
}

/**
 * Seam B: reads the query through the connector, open tickets and those finished at or after `finishedSince`, and
 * saves the read as made at `readAt`, each ticket once by id, replacing the query's last one. A failed read saves
 * nothing, so the last saved read stays in use.
 */
export async function readQuery(connector: Connector, reads: SavedReadStorage, { teamId, query, finishedSince, readAt }: QueryReading): Promise<QueryRead> {
  const teamQuery = { teamId, query }
  const result = await connector.read(query, finishedSince)
  if (!result.ok) {
    const { ok: _, ...failure } = result
    return { ok: false, ...failure, saved: reads.savedRead(teamQuery) }
  }
  // only ids and finish times are kept, each ticket once however many parts of the query match it
  const byId = new Map(result.tickets.map(({ id, finishedAt }) => [id, finishedAt === undefined ? { id } : { id, finishedAt }]))
  const tickets = [...byId.values()]
  const read: SavedRead = { tickets, incomplete: result.incomplete, readAt, finishedSince }
  reads.saveRead(teamQuery, read)
  return { ok: true, read }
}

/** The query's saved read, when there is a query and its read has all its tickets. */
export function completeRead(reads: Pick<SavedReadStorage, 'savedRead'>, teamId: string, query: string | undefined): SavedRead | undefined {
  const read = query ? reads.savedRead({ teamId, query }) : undefined
  return read && !read.incomplete ? read : undefined
}

/** A query's tickets remaining: its open tickets when it was read. */
export function ticketsRemaining(read: SavedRead): number {
  return read.tickets.filter((ticket) => ticket.finishedAt === undefined).length
}

/**
 * The periods to count finished tickets in: `periods` of `cadenceDays` days, counted from the milestone's `startDate`,
 * laid back from the current period (the one holding `today`), which is left out. Days are in the EM's `timeZone`, an
 * IANA name.
 */
export interface FinishedPeriods {
  startDate: string
  cadenceDays: number
  today: string
  timeZone: string
  periods: number
}

/**
 * Seam B: the tickets the read finished in each period, oldest first, each finish counted on its calendar day in the
 * EM's time zone. A quiet period counts 0. Which periods form the window is the caller's.
 */
export function finishedPerPeriod(read: SavedRead, { startDate, cadenceDays, today, timeZone, periods }: FinishedPeriods): DatedCounts {
  const current = Math.floor(daysBetween(startDate, today) / cadenceDays)
  const first = current - periods
  const counts = Array.from({ length: periods }, () => 0)
  const dayOf = calendarDayIn(timeZone)
  for (const { finishedAt } of read.tickets) {
    if (finishedAt === undefined) continue
    const period = Math.floor(daysBetween(startDate, dayOf(finishedAt)) / cadenceDays) - first
    if (period >= 0 && period < periods) counts[period]! += 1
  }
  const starts = counts.map((_, period) => addDays(startDate, (first + period) * cadenceDays))
  return { counts, starts }
}

/** The calendar day, `YYYY-MM-DD`, a UTC instant falls on in `timeZone`. */
export function calendarDayIn(timeZone: string): (instant: string) => string {
  // en-CA writes dates as YYYY-MM-DD
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return (instant) => format.format(new Date(instant))
}
