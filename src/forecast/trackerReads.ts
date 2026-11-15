import type { SavedRead, TeamQuery } from '../model/savedRead.js'
import type { Storage, TeamQueries } from '../storage/storage.js'
import { periodName, type PeriodName } from './cadence.js'
import { dayMonth } from './calendarDate.js'
import type { Connecting } from './connection.js'
import { counted } from './counted.js'
import { calendarDayIn, ticketsRemaining } from './finished.js'
import { paceReads, paceReadsStorage, type PaceFrom, type PaceReads } from './paceReads.js'
import { sameCounts, TRACKER_PERIODS, trackerWindow, type DatedCounts, type TrackerWindowBound } from './paceWindow.js'
import { trackerOf } from './trackers.js'

/**
 * What the Inputs screen and the forecast read of the team's tracker, in the local server build: its connection, its
 * queries and their reads, by target, and the EM's time zone (an IANA name), which reads are dated in. The browser
 * build has none, so its views are the MVP's.
 */
export type TrackerReads = Pick<Connecting, 'connections' | 'queries'> & { timeZone: string }

/** What `measure` reads: the tracker's reads, with the team's queries and their reads in one target. */
export type Measuring = Pick<Connecting, 'connections'> & TeamQueries & { timeZone: string }

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
  /** Pace as the tracker's reads count it; none until a complete read reaches a whole period of the milestone's. */
  pace: PaceReading | undefined
  /**
   * With no pace, because a read it would be taken from is incomplete: the tracker didn't return every finished ticket
   * the query matched, so a pace from it would be part of one.
   */
  paceIncomplete: boolean
}

/**
 * The tracker's reading of pace: up to the 8 most recent whole periods its reads reach, at the milestone's cadence,
 * the current one left out and quiet ones 0, leaving out the quiet periods before the first finished ticket. Kept
 * within forecast/: the Inputs screen is given `PaceReadingView`.
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
  /** What the window's bound says of it (`BOUND_SAID`): its periods, and with none counted, what stops a forecast. */
  said: BoundSaid
  /**
   * With periods skipped, which, and what the window counts instead: "2 skipped (12 Oct, 19 Oct), reaching back to
   * w/c 31 Aug"; none with none skipped.
   */
  skippedLine: string | undefined
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

/** The tracker's reading of pace as the Inputs screen shows it: its periods as bars and blocks, and its lines. */
export interface PaceReadingView {
  /**
   * The periods counted and the skipped ones the window reaches back past, oldest first: a skipped one is a gap. None
   * with nothing finished in any period read, which has no bars.
   */
  periods: { start: string; count: number; skipped: boolean }[]
  /** The counts in the window, oldest first: what the typed counts start from, taken from these periods. */
  counts: number[]
  /**
   * The periods counted, as the source says them, and when they were read: "last 8 weeks · read 12 Nov 09:00"; "7
   * weeks · GitHub has nothing before w/c 21 Sep · read …" when its reads run out first.
   */
  line: string
  /** With the quiet periods before the first finished ticket left out, from when: "From the first finished ticket, 3 Nov." */
  firstFinished: string | undefined
  /**
   * With periods skipped, which, and what the window counts instead, with those skipped, to count again: "2 skipped
   * (12 Oct, 19 Oct), reaching back to w/c 31 Aug"; none with none skipped.
   */
  skipped: { line: string; starts: string[] } | undefined
}

/** The tracker's reading of pace, as the Inputs screen shows it. */
export function paceReadingView({ window, skipped, said, skippedLine, readOn }: PaceReading): PaceReadingView {
  const dated = ({ counts, starts }: DatedCounts, isSkipped: boolean) => starts.map((start, at) => ({ start, count: counts[at]!, skipped: isSkipped }))
  // ISO calendar dates order as strings do
  const periods = said.bars ? [...dated(window, false), ...dated(skipped, true)].sort((a, b) => a.start.localeCompare(b.start)) : []
  return {
    periods,
    counts: window.counts,
    line: `${said.periods} · read ${readOn}`,
    firstFinished: said.firstFinished,
    skipped: skippedLine === undefined ? undefined : { line: skippedLine, starts: skipped.starts },
  }
}

/** The pace the latest read replaced: "was 5, 6, 8 on 28 Oct 09:05". */
export interface WasPace {
  counts: number[]
  /** When the read it came from was made, in the EM's time zone: "28 Oct 09:05". */
  readOn: string
}

/** The tickets remaining the latest read replaced: "was 34 on 28 Oct 09:05". */
export interface WasTickets {
  count: number
  /** When the read it came from was made, in the EM's time zone: "28 Oct 09:05". */
  readOn: string
}

/** The tracker's reading of tickets remaining: the milestone query's open tickets when it was read. */
export interface TicketsReading {
  count: number
  /** The tracker didn't return every ticket the query matched, so `count` is part of them, never used as if whole. */
  incomplete: boolean
  /** When it was read, in the EM's time zone: "4 Nov 09:12". */
  readOn: string
  /** What the read before it gave; none before a second read, nor when the read changed it nothing. */
  was: WasTickets | undefined
  /** The same instant in UTC, as the EM's opening of the reading is kept by (`SeenReads`). */
  readAt: string
}

/**
 * Seam B, behind the views: what the team's tracker measures, for the milestone in `storage` on `today`, from the
 * team's queries and reads in the target `reads` has them in: `saved` for the views, `current` for Check; none with no
 * connection, nor in the browser build.
 */
export function measure(reads: Measuring | undefined, teamId: string, storage: Pick<Storage, 'milestoneInputs'>, today: string): Measured | undefined {
  const connection = reads?.connections.connection(teamId)
  if (!reads || !connection) return undefined
  const tracker = trackerOf(connection).name
  const query = reads.milestoneQueries.milestoneQuery(teamId)?.query
  const read = savedReadOf(reads, teamId, query)
  const pace = paceReading(reads, teamId, storage, today, tracker)
  const comparableWorkRead = savedReadOf(reads, teamId, reads.milestoneQueries.comparableWorkQuery(teamId)?.query)
  return {
    tracker,
    ticketsRemaining: read && { count: ticketsRemaining(read), incomplete: read.incomplete, readOn: readOn(read.readAt, reads.timeZone), readAt: read.readAt, was: wasTickets(reads, teamId, query, ticketsRemaining(read)) },
    pace,
    paceIncomplete: !pace && [read, comparableWorkRead].some((each) => each?.incomplete === true),
  }
}

function savedReadOf(reads: Measuring, teamId: string, query: string | undefined) {
  return query ? reads.reads.savedRead({ teamId, query }) : undefined
}

/** The tickets remaining the query's read before its latest gave, when it differs from `count`. */
function wasTickets(reads: Measuring, teamId: string, query: string | undefined, count: number): WasTickets | undefined {
  const previous = query ? reads.reads.previousRead({ teamId, query }) : undefined
  if (!previous || ticketsRemaining(previous) === count) return undefined
  return { count: ticketsRemaining(previous), readOn: readOn(previous.readAt, reads.timeZone) }
}

/**
 * The counts pace showed before its query's latest read: from the read that one replaced, as pace counted them on the
 * day it was made. None when they are the counts pace shows, nor when the latest read, on its own day, counts the same:
 * the read changed nothing. Pace that came from the other query then gives none.
 */
function wasPace(reads: Measuring, teamId: string, storage: Pick<Storage, 'milestoneInputs'>, from: PaceFrom, query: string | undefined, counts: number[]): WasPace | undefined {
  if (!query) return undefined
  const latest = reads.reads.savedRead({ teamId, query })
  const previous = reads.reads.previousRead({ teamId, query })
  if (!latest || !previous) return undefined
  const was = countsAsThen(reads, teamId, storage, from, query, previous)
  if (!was || sameCounts(was, counts) || sameCounts(was, countsAsThen(reads, teamId, storage, from, query, latest))) return undefined
  return { counts: was, readOn: readOn(previous.readAt, reads.timeZone) }
}

/** The counts pace showed with `read` as the query's, on the day it was made; none had pace come from the other query. */
function countsAsThen(reads: Measuring, teamId: string, storage: Pick<Storage, 'milestoneInputs'>, from: PaceFrom, query: string, read: SavedRead): number[] | undefined {
  const saved = paceReadsStorage(storage, reads)
  const asThen = { ...saved, savedRead: (teamQuery: TeamQuery) => (teamQuery.query === query ? read : saved.savedRead(teamQuery)) }
  const then = paceReads(asThen, teamId, { today: calendarDayIn(reads.timeZone)(read.readAt), timeZone: reads.timeZone })
  return then && then.from === from ? trackerWindow(then, storage.milestoneInputs(teamId)?.paceWindow.skippedPeriods).window.counts : undefined
}

/** The tracker's reading of pace, from `paceReads`: the periods it counts and how they are bounded; none until its query is read. */
function paceReading(reads: Measuring, teamId: string, storage: Pick<Storage, 'milestoneInputs'>, today: string, tracker: string): PaceReading | undefined {
  const inputs = storage.milestoneInputs(teamId)
  const read = paceReads(paceReadsStorage(storage, reads), teamId, { today, timeZone: reads.timeZone })
  const query = read?.from === 'milestone' ? reads.milestoneQueries.milestoneQuery(teamId) : reads.milestoneQueries.comparableWorkQuery(teamId)
  const paceRead = savedReadOf(reads, teamId, query?.query)
  if (!inputs || !read || !paceRead) return undefined
  const { window, skipped, bound } = trackerWindow(read, inputs.paceWindow.skippedPeriods)
  const period = periodName(inputs.cadenceDays)
  return {
    window,
    skipped,
    bound,
    from: read.from,
    milestone: read.milestone,
    comparableWork: read.comparableWork,
    said: BOUND_SAID[bound]({ tracker, period, window, read }),
    skippedLine: skippedLine(skipped, window, period, tracker),
    readOn: readOn(paceRead.readAt, reads.timeZone),
    readAt: paceRead.readAt,
    was: wasPace(reads, teamId, storage, read.from, query?.query, window.counts),
  }
}

/**
 * What a bound says of the window: its periods, as the reading's line says them; whether they are bars to show; with
 * the quiet periods before the first finished ticket left out, from when; and with none counted, the problem that
 * stops a forecast.
 */
export interface BoundSaid {
  periods: string
  bars: boolean
  firstFinished?: string
  problem?: string
}

/** What a bound is said from: the tracker, the milestone's period, the window, and the reads it is taken from. */
interface Saying {
  tracker: string
  period: PeriodName
  window: DatedCounts
  read: PaceReads
}

/** What each bound says of the window, in one place: the reading's line, and the problem when it leaves no pace. */
const BOUND_SAID: Record<TrackerWindowBound, (saying: Saying) => BoundSaid> = {
  full: ({ period }) => ({ periods: `last ${counted(TRACKER_PERIODS, period)}`, bars: true }),
  firstFinished: ({ period, window }) => ({
    periods: counted(window.counts.length, period),
    bars: true,
    firstFinished: `From the first finished ticket, ${dayMonth(window.starts[0]!)}.`,
  }),
  reach: ({ tracker, period, window, read }) => ({
    // the milestone's own pace counts only the periods since its start date
    periods: `${counted(window.counts.length, period)} · ${read.from === 'milestone' && read.beforeStart > 0 ? 'since the start date' : `${tracker} has nothing before ${periodOf(period, window.starts[0]!)}`}`,
    bars: true,
  }),
  // with nothing finished there are no bars
  nothingFinished: ({ tracker, period, read }) => ({
    periods: `nothing finished in the ${counted(read.pace.counts.length, period)} ${tracker} reads`,
    bars: false,
    problem: `${tracker} has no finished tickets in the ${period}s it read, so there is no pace. Type counts, or switch pace to the range.`,
  }),
  // with every period skipped, the bars show the gaps to count again
  everySkipped: ({ tracker, period }) => ({
    periods: `every ${period} skipped`,
    bars: true,
    problem: `Every ${period} is skipped, so ${tracker} gives no pace. Count a ${period} again, or use typed counts or the range.`,
  }),
  everyFinishedSkipped: ({ tracker, period }) => ({
    periods: `every ${period} that finished something skipped`,
    bars: true,
    problem: `Every ${period} that finished something is skipped, so ${tracker} gives no pace. Count a ${period} again, or use typed counts or the range.`,
  }),
}

/**
 * The skipped periods the window reaches back past, and what it counts instead: "2 skipped (12 Oct, 19 Oct), reaching
 * back to w/c 31 Aug"; "…, and GitHub has no earlier weeks to count instead" short of 8; "…, so no weeks count".
 */
function skippedLine(skipped: DatedCounts, window: DatedCounts, period: PeriodName, tracker: string): string | undefined {
  if (skipped.starts.length === 0) return undefined
  const which = `${skipped.starts.length} skipped (${skipped.starts.map(dayMonth).join(', ')})`
  const first = window.starts[0]
  if (first === undefined) return `${which}, so no ${period}s count`
  if (window.starts.length < TRACKER_PERIODS) return `${which}, and ${tracker} has no earlier ${period}s to count instead`
  return `${which}, reaching back to ${periodOf(period, first)}`
}

/** The period starting on `start`, as the reading's lines name it: "w/c 31 Aug", "the sprint of 31 Aug". */
function periodOf(period: PeriodName, start: string): string {
  return `${period === 'week' ? 'w/c' : 'the sprint of'} ${dayMonth(start)}`
}

/** A UTC instant as the screens date a read, in `timeZone`: "4 Nov 09:12". */
export function readOn(instant: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const part = (type: Intl.DateTimeFormatPartTypes): string => format.formatToParts(new Date(instant)).find((each) => each.type === type)?.value ?? ''
  return `${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`
}
