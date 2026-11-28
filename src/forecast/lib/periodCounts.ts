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
  /**
   * With no open tickets in comparable work's read, where it ends: the period its last ticket finished in, and that
   * ticket's day; none with one open, or with its last ticket finished in the last of the periods or after them.
   */
  comparableWorkEnds: ComparableWorkEnds | undefined
}

/** Where finished comparable work ends: the start of the period its last ticket finished in, and that ticket's day. */
export interface ComparableWorkEnds {
  start: string
  day: string
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

/** The period a calendar day falls in, counted from the start date (negative before it). */
function periodOn(day: string, { startDate, cadence }: { startDate: string; cadence: number }): number {
  return Math.floor(daysBetween(startDate, day) / cadence)
}

/**
 * The tickets the read finished in each of the `periods` from the `first` (`wholePeriods`), oldest first, each finish
 * counted on its calendar day in the EM's time zone. A quiet period counts 0.
 */
export function finishedPerPeriod(
  read: SavedRead,
  { startDate, cadence, timeZone, first, periods }: Pick<ReadCalendar, 'cadence' | 'timeZone'> & { startDate: string; first: number; periods: number },
): DatedCounts {
  const counts = Array.from({ length: periods }, () => 0)
  const dayOf = calendarDayIn(timeZone)
  for (const { finishedAt } of read.tickets) {
    if (finishedAt === undefined) continue
    const period = periodOn(dayOf(finishedAt), { startDate, cadence }) - first
    if (period >= 0 && period < periods) counts[period]! += 1
  }
  const starts = counts.map((_, period) => addDays(startDate, (first + period) * cadence))
  return { counts, starts }
}

/**
 * The current period, the one holding today, which pace leaves out until it ends: the date it starts on, and the
 * tickets the read finished in it so far, each counted on its calendar day in the EM's time zone. Read before it
 * began, the read finished none it can see: instead, the periods waiting for a read, which pace leaves out too
 * (`wholePeriods`), from the oldest of it and the other reads the window ends at (`windowReads`).
 */
export function currentPeriod(read: SavedRead, windowReads: readonly SavedRead[], of: ReadCalendar & { startDate: string }): CurrentPeriod {
  const { startDate, cadence, today, timeZone } = of
  const current = periodOn(today, of)
  const start = addDays(startDate, current * cadence)
  const dayOf = calendarDayIn(timeZone)
  // the window ends at the oldest of the reads
  const readOn = [read, ...windowReads].map(({ readAt }) => dayOf(readAt)).reduce((oldest, day) => (day < oldest ? day : oldest))
  const readIn = periodOn(readOn, of)
  if (readIn < current) return { start, waiting: { from: addDays(startDate, readIn * cadence), periods: current - readIn, readOn } }
  return { start, finished: read.tickets.filter(({ finishedAt }) => finishedAt !== undefined && daysBetween(start, dayOf(finishedAt)) >= 0).length }
}

/**
 * The current period: the date it starts on; and the tickets the read finished in it so far, or, read before it began,
 * the periods waiting for a read: from the one it was read in, how many, up to the current one, and the day it was read on.
 */
export type CurrentPeriod = { start: string } & ({ finished: number } | { waiting: { from: string; periods: number; readOn: string } })

/**
 * The periods the reads all reach whole: the `first`, counted from the start date (negative before it), and how many
 * (`periods`), up to the current one, which is left out, or the earlier one a read was made in, which it reaches only
 * part of. A period a read reaches only part of would pass for a quieter one.
 */
export function wholePeriods(reads: readonly SavedRead[], of: ReadCalendar & { startDate: string }): { first: number; periods: number } {
  const dayOf = calendarDayIn(of.timeZone)
  const last = Math.min(periodOn(of.today, of), ...reads.map((read) => periodOn(dayOf(read.readAt), of)))
  const first = Math.max(...reads.map((read) => Math.ceil((daysBetween(of.startDate, dayOf(read.finishedSince)) + 1) / of.cadence)))
  return { first, periods: Math.max(0, last - first) }
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
  const counted = (read: SavedRead): DatedCounts => finishedPerPeriod(read, { ...laid, first, periods })
  const milestone = milestoneRead && counted(milestoneRead)
  const comparableWork = comparableRead && counted(comparableRead)
  // a query matching nothing finished in the periods counted is flagged as not used, so pace falls back to the milestone's own
  const usesComparable = comparableWork !== undefined && comparableWork.counts.some((count) => count > 0)
  const beforeStart = Math.min(periods, Math.max(0, -first))
  const picked = picks.flatMap(({ query, read }) => {
    const own = completeRead(read)
    return own ? [{ query, counts: counted(own) }] : []
  })
  const comparableWorkEnds = comparableRead && endsOf(comparableRead, { ...laid, first, periods })
  const both = { milestone, beforeStart, comparableWork, picks: picked, comparableWorkEnds }
  if (usesComparable) return { counts: comparableWork, sides: { ...both, from: 'comparableWork', comparableWork } }
  if (milestone === undefined) return undefined
  return {
    counts: { counts: milestone.counts.slice(beforeStart), starts: milestone.starts.slice(beforeStart) },
    sides: { ...both, from: 'milestone', milestone },
  }
}

/**
 * Where a read with no open tickets ends (`ComparableWorkEnds`), among the `periods` from the `first`: none with a
 * ticket open, or with its last ticket finished in the last of them or after.
 */
function endsOf(read: SavedRead, of: ReadCalendar & { startDate: string; first: number; periods: number }): ComparableWorkEnds | undefined {
  if (read.tickets.some(({ finishedAt }) => finishedAt === undefined)) return undefined
  // ISO calendar dates order as strings do
  const day = read.tickets
    .flatMap(({ finishedAt }) => (finishedAt === undefined ? [] : [calendarDayIn(of.timeZone)(finishedAt)]))
    .sort()
    .at(-1)
  if (day === undefined) return undefined
  const period = periodOn(day, of) - of.first
  if (period < 0 || period >= of.periods - 1) return undefined
  return { start: addDays(of.startDate, (of.first + period) * of.cadence), day }
}
