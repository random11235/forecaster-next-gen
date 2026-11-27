import type { SavedRead } from '../../model/savedRead.js'
import { periodName, type PeriodName } from './cadence.js'
import { dayMonth, readOn } from './calendarDate.js'
import {
  calendarDayIn,
  finishedInCurrent,
  sideBySide,
  type CurrentPeriod,
  type DatedCounts,
  type PaceFrom,
  type QueryReads,
  type ReadCalendar,
  type SavedPaceReads,
  type SideBySide,
} from './periodCounts.js'
import { BOUND_SAID, skippedLine, trackerWindow, type BoundSaid, type TrackerWindowBound } from './trackerWindow.js'

// The tracker's reading of pace, from the reads side by side, and the pace the latest read replaced.

/**
 * The tracker's reading of pace: up to the 8 most recent whole periods its reads reach, at the milestone's cadence,
 * the current one left out and quiet ones 0, leaving out the quiet periods before the first finished ticket.
 */
export interface PaceReading {
  /** The finished tickets in each period counted, oldest first; empty with nothing finished in any period read. */
  window: DatedCounts
  /** The periods the EM skipped that the window reaches back past, oldest first, with what each finished. */
  skipped: DatedCounts
  /** What bounds the window: its reach, the first finished ticket, or, empty, nothing finished or every period skipped. */
  bound: TrackerWindowBound
  /** Whose finished tickets they are: comparable work's, or the milestone's own. */
  from: PaceFrom
  /**
   * The milestone's own finished tickets in each period its read reaches whole, before its start date too; none while
   * that read is incomplete.
   */
  milestone: DatedCounts | undefined
  /** Comparable work's finished tickets in each period its read reaches whole; none with no query, or no complete read of it. */
  comparableWork: DatedCounts | undefined
  /** What the window's bound says of it: its periods, and with none counted, what stops a forecast. */
  said: BoundSaid
  /**
   * With periods skipped, which, and what the window counts instead: "2 skipped (12 Oct, 19 Oct), reaching back to
   * w/c 31 Aug"; none with none skipped.
   */
  skippedLine: string | undefined
  /**
   * The current period, left out of pace until it ends, with the tickets the read pace comes from finished in it so
   * far: "This week, from 9 Nov, counts once it ends: 2 finished so far." (#390)
   */
  current: string
  /** When the read pace comes from was read, in the EM's time zone: "4 Nov 09:12". */
  readOn: string
  /** The same instant in UTC, as the EM's opening of the reading is kept by (`SeenReads`). */
  readAt: string
  /**
   * The counts pace showed before the latest read replaced the one before it, on the day that one was read; none
   * before a second read, nor when the read changed nothing.
   */
  was: WasPace | undefined
}

/** The pace the latest read replaced: "was 5, 6, 8 on 28 Oct 09:05". */
export interface WasPace {
  counts: number[]
  /** When the read it came from was made, in the EM's time zone: "28 Oct 09:05". */
  readOn: string
}

/** The tracker's reading of pace, from the reads side by side: the periods it counts and how they are bounded. */
export function readingOf(
  saved: SavedPaceReads,
  { counts, sides }: { counts: DatedCounts; sides: SideBySide },
  tracker: string,
  of: ReadCalendar,
): PaceReading | undefined {
  const fromReads = sides.from === 'milestone' ? saved.milestone : saved.comparableWork
  const paceRead = fromReads?.latest
  if (!paceRead || of.startDate === undefined) return undefined
  const { window, skipped, bound } = trackerWindow(counts, sides, of.paceWindow.skippedPeriods)
  const period = periodName(of.cadence)
  return {
    window,
    skipped,
    bound,
    from: sides.from,
    milestone: sides.milestone,
    comparableWork: sides.comparableWork,
    said: BOUND_SAID[bound]({ tracker, period, window, sides, counts }),
    skippedLine: skippedLine(skipped, window, period, tracker),
    current: currentSaid(finishedInCurrent(paceRead, { ...of, startDate: of.startDate }), period),
    readOn: readOn(paceRead.readAt, of.timeZone),
    readAt: paceRead.readAt,
    was: fromReads && wasPace(saved, fromReads, sides.from, window.counts, of),
  }
}

/** The current period, as the reading's line says it: "This sprint, from 9 Nov, counts once it ends: none finished so far." */
function currentSaid({ start, count }: CurrentPeriod, period: PeriodName): string {
  return `This ${period}, from ${dayMonth(start)}, counts once it ends: ${count === 0 ? 'none' : count} finished so far.`
}

/** The same counts, in the same order; never with none to compare. */
export function sameCounts(some: readonly number[], others: readonly number[] | undefined): boolean {
  return others !== undefined && some.length === others.length && some.every((count, period) => count === others[period])
}

/**
 * The counts pace showed before its query's latest read: from the read that one replaced, as pace counted them on the
 * day it was made. None when they are the counts pace shows, nor when the latest read, on its own day, counts the same:
 * the read changed nothing. Pace that came from the other query then gives none.
 */
function wasPace(saved: SavedPaceReads, { query, latest, previous }: QueryReads, from: PaceFrom, counts: number[], of: ReadCalendar): WasPace | undefined {
  if (!latest || !previous) return undefined
  const was = countsAsThen(saved, query, previous, from, of)
  if (!was || sameCounts(was, counts) || sameCounts(was, countsAsThen(saved, query, latest, from, of))) return undefined
  return { counts: was, readOn: readOn(previous.readAt, of.timeZone) }
}

/** The counts pace showed with `read` as the query's, on the day it was made; none had pace come from the other query. */
function countsAsThen(saved: SavedPaceReads, query: string, read: SavedRead, from: PaceFrom, of: ReadCalendar): number[] | undefined {
  const asThen = (reads: QueryReads | undefined) => reads && (reads.query === query ? { ...reads, latest: read } : reads)
  const then = sideBySide(
    { ...saved, milestone: asThen(saved.milestone), comparableWork: asThen(saved.comparableWork) },
    { ...of, today: calendarDayIn(of.timeZone)(read.readAt) },
  )
  return then && then.sides.from === from ? trackerWindow(then.counts, then.sides, of.paceWindow.skippedPeriods).window.counts : undefined
}
