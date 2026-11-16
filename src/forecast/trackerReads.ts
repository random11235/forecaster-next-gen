import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { SavedRead } from '../model/savedRead.js'
import type { TeamQueries } from '../storage/storage.js'
import { readOn } from './calendarDate.js'
import { withTeamQueries, type Connecting } from './connection.js'
import {
  paceOf,
  savedPaceReads,
  ticketsRemaining,
  type ChosenSourcePace,
  type DatedCounts,
  type Pace,
  type PaceReading,
  type SavedPaceReads,
} from './lib/pace.js'
import type { ForecastSettings } from './settings.js'
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
  /** The team's saved reads pace is measured from (`paceOf`). */
  paceReads: SavedPaceReads
  /** The EM's time zone (an IANA name), which reads are dated and counted in. */
  timeZone: string
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

/** What the team's tracker measures for the views, from what's saved (`measure` in `saved`); none without a tracker. */
export function measureSaved(tracker: TrackerReads | undefined, teamId: string): Measured | undefined {
  return measure(tracker && withTeamQueries(tracker, 'saved'), teamId)
}

/**
 * Seam B, behind the views: what the team's tracker measures, from the team's queries and reads in the target `reads`
 * has them in: `saved` for the views, `current` for Check; none with no connection, nor in the browser build.
 */
export function measure(reads: Measuring | undefined, teamId: string): Measured | undefined {
  const connection = reads?.connections.connection(teamId)
  if (!reads || !connection) return undefined
  const paceReads = savedPaceReads(reads, teamId)
  const read = paceReads.milestone?.latest
  return {
    tracker: trackerOf(connection).name,
    ticketsRemaining: read && {
      count: ticketsRemaining(read),
      incomplete: read.incomplete,
      readOn: readOn(read.readAt, reads.timeZone),
      readAt: read.readAt,
      was: wasTickets(paceReads.milestone?.previous, ticketsRemaining(read), reads.timeZone),
    },
    paceReads,
    timeZone: reads.timeZone,
  }
}

/** The tickets remaining the query's read before its latest gave, when it differs from `count`. */
function wasTickets(previous: SavedRead | undefined, count: number, timeZone: string): WasTickets | undefined {
  if (!previous || ticketsRemaining(previous) === count) return undefined
  return { count: ticketsRemaining(previous), readOn: readOn(previous.readAt, timeZone) }
}

/**
 * The milestone's pace on `today` (`paceOf`), from the source the EM chose, with what the team's tracker measures
 * (`measured`; none with no connection, when following the tracker falls back to the typed counts). Each view works it
 * out once, and every part of the view that shows pace takes it from there.
 */
export function milestonePace(inputs: MilestoneInputs, settings: ForecastSettings, today: string, measured: Measured | undefined): ChosenSourcePace {
  const of = { paceWindow: inputs.paceWindow, cadence: inputs.cadenceDays, startDate: inputs.startDate, settings }
  if (!measured) return paceOf({ ...of, reads: { chosen: inputs }, clock: { today, timeZone: 'UTC' } })
  const { paceReads: saved, tracker, timeZone } = measured
  return paceOf({ ...of, reads: { saved, tracker, chosen: inputs }, clock: { today, timeZone } })
}

/** The milestone's pace on `today` as the tracker reads it (`paceOf`), whichever source the EM chose: its reading, none until it is read. */
export function trackerPace(inputs: MilestoneInputs, today: string, { paceReads: saved, tracker, timeZone }: Measured): Pace {
  return paceOf({
    paceWindow: inputs.paceWindow,
    cadence: inputs.cadenceDays,
    startDate: inputs.startDate,
    reads: { saved, tracker },
    clock: { today, timeZone },
  })
}
