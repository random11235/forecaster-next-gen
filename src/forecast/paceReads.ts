import type { SavedRead } from '../model/savedRead.js'
import { DAY_MS } from '../model/time.js'
import type { MilestoneQueryStorage, SavedReadStorage, Storage } from '../storage/storage.js'
import { daysBetween } from './calendarDate.js'
import { calendarDayIn, finishedPerPeriod, ticketsRemaining } from './finished.js'
import { FINISHED_WEEKS } from './milestoneStep.js'
import type { DatedCounts } from './paceWindow.js'

/** Where pace's finished tickets come from: comparable work's read, or the milestone query's. */
export type PaceFrom = 'comparableWork' | 'milestone'

/**
 * The team's two reads as pace counts them, per period, side by side: the periods both reads reach whole, oldest
 * first, the current one left out, laid on the milestone's cadence from its start date.
 */
export interface PaceReads {
  from: PaceFrom
  /** The finished tickets per period pace is measured from: the typed counts proposed. */
  pace: DatedCounts
  /** The milestone's own finished tickets in each period, before its start date too, so the two can be paired. */
  milestone: DatedCounts
  /** How many of those periods come before the milestone's start date: its own pace counts only those after. */
  beforeStart: number
  /** Comparable work's finished tickets in each period; none with no query, or no complete read of it. */
  comparableWork: DatedCounts | undefined
  /** The milestone query's open tickets; comparable work's never count. */
  ticketsRemaining: number
}

/** Today, and the EM's time zone (an IANA name), which each finish is counted on its calendar day in. */
export interface PaceDay {
  today: string
  timeZone: string
}

/**
 * Seam B: the team's saved reads as pace counts them. Once a comparable-work query is added and its read finished
 * something, pace comes from comparable work's finished tickets alone; with no query, or one matching nothing finished
 * in the weeks it reads back, from the milestone's own, over the periods since its start date. Each read's tickets
 * count once by id. A read that is incomplete isn't counted. None before the milestone has a start date and a complete
 * read of its query.
 */
export function paceReads(storage: Storage & MilestoneQueryStorage & SavedReadStorage, teamId: string, { today, timeZone }: PaceDay): PaceReads | undefined {
  const inputs = storage.milestoneInputs(teamId)
  const milestoneRead = completeRead(storage, teamId, storage.milestoneQuery(teamId)?.query)
  if (inputs?.startDate === undefined || milestoneRead === undefined) return undefined
  const comparableRead = completeRead(storage, teamId, storage.comparableWorkQuery(teamId)?.query)
  const { startDate, cadenceDays } = inputs
  const current = Math.floor(daysBetween(startDate, today) / cadenceDays)
  const reads = comparableRead === undefined ? [milestoneRead] : [milestoneRead, comparableRead]
  const first = Math.max(...reads.map((read) => firstWholePeriod(read, startDate, cadenceDays, timeZone)))
  const periods = Math.max(0, current - first)
  const counted = (read: SavedRead): DatedCounts => finishedPerPeriod(read, { startDate, cadenceDays, today, timeZone, periods })
  const milestone = counted(milestoneRead)
  const comparableWork = comparableRead && counted(comparableRead)
  const beforeStart = Math.min(periods, Math.max(0, -first))
  const both = { milestone, beforeStart, comparableWork, ticketsRemaining: ticketsRemaining(milestoneRead) }
  // a query matching nothing finished is flagged as not used, so pace falls back to the milestone's own
  if (comparableWork !== undefined && comparableRead !== undefined && finishedAny(comparableRead)) return { from: 'comparableWork', pace: comparableWork, ...both }
  return { from: 'milestone', pace: { counts: milestone.counts.slice(beforeStart), starts: milestone.starts.slice(beforeStart) }, ...both }
}

/** Whether the read finished anything in the weeks it reads back. */
function finishedAny(read: SavedRead): boolean {
  return read.tickets.length > ticketsRemaining(read)
}

/** The query's saved read, when there is a query and its read has all its tickets. */
function completeRead(reads: SavedReadStorage, teamId: string, query: string | undefined): SavedRead | undefined {
  const read = query ? reads.savedRead({ teamId, query }) : undefined
  return read && !read.incomplete ? read : undefined
}

/**
 * The first period, counted from the start date, that the read reaches whole: the first starting after the day its
 * reach back of `FINISHED_WEEKS` weeks falls on, as a period it reaches only part of would pass for a quiet one.
 */
export function firstWholePeriod(read: SavedRead, startDate: string, cadenceDays: number, timeZone: string): number {
  const reachedOn = calendarDayIn(timeZone)(new Date(Date.parse(read.readAt) - FINISHED_WEEKS * 7 * DAY_MS).toISOString())
  return Math.ceil((daysBetween(startDate, reachedOn) + 1) / cadenceDays)
}
