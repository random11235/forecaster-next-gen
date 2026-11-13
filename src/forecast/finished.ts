import type { Connector, Failure } from '../connectors/connector.js'
import type { SavedRead, TeamQuery } from '../model/savedRead.js'
import type { SavedReadStorage } from '../storage/storage.js'
import { addDays, daysBetween } from './calendarDate.js'
import type { DatedCounts } from './paceWindow.js'

/** A query read and saved; or a failed read, with the read saved before it, which is kept (none if it was never read). */
export type QueryRead = { ok: true; read: SavedRead } | ({ ok: false; saved: SavedRead | undefined } & Failure)

/** A read of one of a team's queries: its tickets open, or finished at or after `finishedSince`, read at `readAt`. */
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
  const read: SavedRead = { tickets, incomplete: result.incomplete, readAt }
  reads.saveRead(teamQuery, read)
  return { ok: true, read }
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
