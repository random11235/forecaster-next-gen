import type { MilestoneInputs, PaceWindow } from '../../model/milestoneInputs.js'
import type { SavedRead } from '../../model/savedRead.js'
import type { TeamQueries } from '../../storage/storage.js'
import { addDays, daysBetween } from './calendarDate.js'
import { completeRead } from './queryRead.js'

// Pace's saved reads, and their finished tickets counted per period side by side, on the EM's calendar days.

/** Counts, oldest first, each period starting on the date at the same place in `starts`. */
export interface DatedCounts {
  counts: number[]
  starts: string[]
}

/** When pace is counted: today, and the EM's time zone (an IANA name) each finish is counted on its calendar day in. */
export interface PaceClock {
  today: string
  timeZone: string
}

/** When the tracker is read: the UTC instant (`readAt`), and pace's clock, today in the EM's time zone. */
export interface ReadClock extends PaceClock {
  readAt: string
}

/**
 * The milestone's calendar pace is counted on: its pace window (its skipped periods and the pace action applied), its
 * cadence in days, its start date (a candidate is laid from today without one), and today. Without a time zone: where
 * a read is counted, it is a `ReadCalendar`.
 */
export interface PaceCalendar {
  paceWindow: PaceWindow
  cadence: number
  startDate: string | undefined
  today: string
}

/** The milestone's calendar pace is counted on, from its inputs, on `today`. */
export function paceCalendar(
  { paceWindow, cadenceDays, startDate }: Pick<MilestoneInputs, 'paceWindow' | 'cadenceDays' | 'startDate'>,
  today: string,
): PaceCalendar {
  return { paceWindow, cadence: cadenceDays, startDate, today }
}

/** The calendar a read's finishes are counted on, on the clock's calendar days. */
export type ReadCalendar = PaceCalendar & PaceClock

/** One of the team's queries, with its latest saved read and the one that read replaced. */
export interface QueryReads {
  query: string
  latest: SavedRead | undefined
  previous: SavedRead | undefined
}

/**
 * The team's saved reads pace is measured from: the milestone query's and comparable work's, side by side (none with
 * no query), and each of comparable work's picks' own.
 */
export interface SavedPaceReads {
  milestone: QueryReads | undefined
  comparableWork: QueryReads | undefined
  picks: { query: string; read: SavedRead | undefined }[]
}

/** Where pace's finished tickets come from: comparable work's read, or the milestone query's. */
export type PaceFrom = 'comparableWork' | 'milestone'

/**
 * The team's two reads as pace counts them, per period, side by side: the periods both reads reach whole, oldest
 * first, the current one left out, laid on the milestone's cadence from its start date.
 */
export type SideBySide = SideBySideReads & ({ from: 'comparableWork'; comparableWork: DatedCounts } | { from: 'milestone'; milestone: DatedCounts })

/** The reads side by side, whichever pace comes from: the read it comes from is never missing (`SideBySide`). */
interface SideBySideReads {
  from: PaceFrom
  /**
   * The milestone's own finished tickets in each period, before its start date too, so the two can be paired; none
   * while its read is incomplete.
   */
  milestone: DatedCounts | undefined
  /** How many of those periods come before the milestone's start date: its own pace counts only those after. */
  beforeStart: number
  /** Comparable work's finished tickets in each period; none with no query, or no complete read of it. */
  comparableWork: DatedCounts | undefined
  /** Each of comparable work's picks with a complete read, its own finished tickets in the same periods, in the order picked. */
  picks: { query: string; counts: DatedCounts }[]
}

/** The team's saved reads pace is measured from, from the target `queries` keeps them in; it asks the tracker nothing. */
export function savedPaceReads({ milestoneQueries, reads }: TeamQueries, teamId: string): SavedPaceReads {
  const readsOf = (query: string | undefined): QueryReads | undefined =>
    query === undefined ? undefined : { query, latest: reads.savedRead({ teamId, query }), previous: reads.previousRead({ teamId, query }) }
  const comparableWork = milestoneQueries.comparableWorkQuery(teamId)
  return {
    milestone: readsOf(milestoneQueries.milestoneQuery(teamId)?.query),
    comparableWork: readsOf(comparableWork?.query),
    picks: (comparableWork?.picks ?? []).map(({ query }) => ({ query, read: reads.savedRead({ teamId, query }) })),
  }
}

/** The calendar day, `YYYY-MM-DD`, a UTC instant falls on in `timeZone`. */
export function calendarDayIn(timeZone: string): (instant: string) => string {
  // en-CA writes dates as YYYY-MM-DD
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return (instant) => format.format(new Date(instant))
}

/**
 * The tickets the read finished in each of the `periods` before the current one (the one holding today), oldest
 * first, each finish counted on its calendar day in the EM's time zone. A quiet period counts 0.
 */
export function finishedPerPeriod(
  read: SavedRead,
  { startDate, cadence, today, timeZone, periods }: ReadCalendar & { startDate: string; periods: number },
): DatedCounts {
  const current = Math.floor(daysBetween(startDate, today) / cadence)
  const first = current - periods
  const counts = Array.from({ length: periods }, () => 0)
  const dayOf = calendarDayIn(timeZone)
  for (const { finishedAt } of read.tickets) {
    if (finishedAt === undefined) continue
    const period = Math.floor(daysBetween(startDate, dayOf(finishedAt)) / cadence) - first
    if (period >= 0 && period < periods) counts[period]! += 1
  }
  const starts = counts.map((_, period) => addDays(startDate, (first + period) * cadence))
  return { counts, starts }
}

/**
 * The periods the reads all reach whole, up to the current one, which is left out: the `first`, counted from the start
 * date (negative before it), and how many (`periods`). A period a read reaches only part of would pass for a quiet one.
 */
export function wholePeriods(
  reads: readonly SavedRead[],
  { startDate, cadence, today, timeZone }: ReadCalendar & { startDate: string },
): { first: number; periods: number } {
  const current = Math.floor(daysBetween(startDate, today) / cadence)
  const first = Math.max(...reads.map((read) => Math.ceil((daysBetween(startDate, calendarDayIn(timeZone)(read.finishedSince)) + 1) / cadence)))
  return { first, periods: Math.max(0, current - first) }
}

/** Whether the latest read of the milestone query, or of comparable work, is incomplete. */
export function latestIncomplete({ milestone, comparableWork }: SavedPaceReads): boolean {
  return [milestone, comparableWork].some((reads) => reads?.latest?.incomplete === true)
}

/**
 * The saved reads side by side, and the counts pace comes from; none before the milestone has a start date, nor
 * without a complete read to take pace from.
 */
export function sideBySide(
  { milestone: milestoneReads, comparableWork: comparableReads, picks }: SavedPaceReads,
  of: ReadCalendar,
): { counts: DatedCounts; sides: SideBySide } | undefined {
  const { startDate } = of
  if (startDate === undefined) return undefined
  const milestoneRead = completeRead(milestoneReads?.latest)
  const comparableRead = completeRead(comparableReads?.latest)
  const reads = [milestoneRead, comparableRead].filter((read) => read !== undefined)
  if (reads.length === 0) return undefined
  const laid = { ...of, startDate }
  const { first, periods } = wholePeriods(reads, laid)
  const counted = (read: SavedRead): DatedCounts => finishedPerPeriod(read, { ...laid, periods })
  const milestone = milestoneRead && counted(milestoneRead)
  const comparableWork = comparableRead && counted(comparableRead)
  // a query matching nothing finished in the periods counted is flagged as not used, so pace falls back to the milestone's own
  const usesComparable = comparableWork !== undefined && comparableWork.counts.some((count) => count > 0)
  const beforeStart = Math.min(periods, Math.max(0, -first))
  const picked = picks.flatMap(({ query, read }) => {
    const own = completeRead(read)
    return own ? [{ query, counts: counted(own) }] : []
  })
  const both = { milestone, beforeStart, comparableWork, picks: picked }
  if (usesComparable) return { counts: comparableWork, sides: { ...both, from: 'comparableWork', comparableWork } }
  if (milestone === undefined) return undefined
  return {
    counts: { counts: milestone.counts.slice(beforeStart), starts: milestone.starts.slice(beforeStart) },
    sides: { ...both, from: 'milestone', milestone },
  }
}
