import type { SavedRead } from '../../model/savedRead.js'
import type { ForecastSettings } from './settings.js'
import { inUseOf, notesOf, type ChosenPace, type PaceInUse, type PaceNote, type PaceWarning } from './paceInUse.js'
import { readingOf, type PaceReading } from './paceReading.js'
import {
  finishedPerPeriod,
  latestIncomplete,
  sideBySide,
  wholePeriods,
  type DatedCounts,
  type PaceCalendar,
  type PaceClock,
  type ReadCalendar,
  type SavedPaceReads,
  type SideBySide,
} from './periodCounts.js'

export { actionSaid, withAction, type PaceCounts, type PaceInUse } from './paceInUse.js'
export { sameCounts, type PaceReading, type WasPace } from './paceReading.js'
export {
  calendarDayIn,
  paceCalendar,
  savedPaceReads,
  type DatedCounts,
  type PaceClock,
  type PaceFrom,
  type ReadClock,
  type SavedPaceReads,
} from './periodCounts.js'

// Pace, worked out in one place (#243): `paceOf` is the way in, and this file the only import pace's callers use.
// Behind it, its sibling files: the reads counted per period side by side (periodCounts.ts), the tracker's window
// (trackerWindow.ts) and reading (paceReading.ts), and the pace in use and its notes (paceInUse.ts). Reading a query
// is not pace: it has its own entry point, `forecast/queryRead.ts`.

/**
 * The reads pace is counted from: the team's saved reads, with the connected `tracker` that the reading's lines name
 * (none, as in the Comparable work step, which shows no reading); or a candidate's read, kept only by its opening.
 */
export type PaceReads = { saved: SavedPaceReads; tracker?: string } | { candidate: SavedRead }

/** The `reads` counted, on the clock's calendar days; or none, with no tracker connected, and then no time zone. */
type Counted<Reads> = { reads: Reads } & PaceClock
type NoneCounted = { reads?: undefined; timeZone?: undefined }

/** A source `chosen`, with the `settings` its notes are judged against; or neither. */
type Chosen = { chosen: ChosenPace; settings: Pick<ForecastSettings, 'typedCounts'> }
type NoneChosen = { chosen?: undefined; settings?: undefined }

/**
 * What `paceOf` is asked: the milestone's calendar; the `reads` pace is counted from, if any; and the source `chosen`,
 * if any, which a candidate's read never has.
 */
export type PaceQuestion = PaceCalendar &
  (
    | ((Counted<Extract<PaceReads, { saved: SavedPaceReads }>> | NoneCounted) & (Chosen | NoneChosen))
    | (Counted<Extract<PaceReads, { candidate: SavedRead }>> & NoneChosen)
  )

/** Pace, as `paceOf` measures it with a source chosen: with the pace in use. */
export type ChosenSourcePace = Pace & { inUse: PaceInUse }

/** Pace, as `paceOf` measures it. */
export interface Pace {
  /**
   * The finished tickets per period pace is measured from: of the saved reads, those pace comes from, the milestone's
   * own over the periods since its start date; of a candidate, every whole period its read reaches. None before the
   * milestone has a start date, nor without a complete read to take pace from.
   */
  counts: DatedCounts | undefined
  /** The saved reads side by side; none whenever `counts` is none, and for a candidate. */
  sideBySide: SideBySide | undefined
  /** The connected tracker's reading of pace, from the saved reads; none without `counts`, nor without a tracker. */
  reading: PaceReading | undefined
  /** With no reading, because a read it would be taken from is incomplete. */
  incomplete: boolean
  /** The pace in use, from the source chosen; none with none chosen. */
  inUse: PaceInUse | undefined
  /** What stops a forecast from the pace in use; then the warnings about it. */
  problems: PaceNote[]
  warnings: PaceWarning[]
}

/**
 * The way into pace for the views, the Comparable work step and its candidates, behind Seam B: pace counted from
 * `reads` and, with a source `chosen`, the pace in use. Once a comparable-work query is added and its read finished
 * something, pace comes from comparable work's finished tickets alone; with no query, or one matching nothing finished
 * in the periods counted, from the milestone's own, over the periods since its start date. Each read's tickets count
 * once by id, on its calendar day in the EM's time zone. A read that is incomplete isn't counted: the milestone
 * query's leaves its own counts unknown, but not a pace from comparable work.
 */
export function paceOf(of: PaceQuestion & Chosen): ChosenSourcePace
export function paceOf(of: PaceQuestion): Pace
export function paceOf(of: PaceQuestion): Pace {
  if (of.reads !== undefined && 'candidate' in of.reads) return { ...NO_PACE, counts: candidateCounts(of.reads.candidate, of) }
  const tracker = of.reads?.tracker
  const measured = of.reads !== undefined ? measuredFrom(of.reads.saved, tracker, of) : NOT_MEASURED
  if (!of.chosen) return { ...NO_PACE, ...measured }
  const { reading, incomplete } = measured
  const inUse = inUseOf(of.chosen, tracker !== undefined ? { tracker, reading, incomplete } : undefined, of)
  return { ...measured, inUse, ...notesOf(inUse, of, of.settings) }
}

type CountedPace = Pick<Pace, 'counts' | 'sideBySide' | 'reading' | 'incomplete'>

const NOT_MEASURED: CountedPace = { counts: undefined, sideBySide: undefined, reading: undefined, incomplete: false }

/** Pace as the saved reads measure it, with the connected `tracker`'s reading (none without a tracker). */
function measuredFrom(saved: SavedPaceReads, tracker: string | undefined, of: ReadCalendar): CountedPace {
  const sides = sideBySide(saved, of)
  const reading = sides && tracker !== undefined ? readingOf(saved, sides, tracker, of) : undefined
  return { counts: sides?.counts, sideBySide: sides?.sides, reading, incomplete: !reading && latestIncomplete(saved) }
}

/** A candidate's finished tickets in every whole period its read reaches, laid from today before the milestone has a start date. */
function candidateCounts(candidate: SavedRead, of: ReadCalendar): DatedCounts {
  const laid = { ...of, startDate: of.startDate ?? of.today }
  return finishedPerPeriod(candidate, { ...laid, ...wholePeriods([candidate], laid) })
}

const NO_PACE: Pace = { counts: undefined, sideBySide: undefined, reading: undefined, incomplete: false, inUse: undefined, problems: [], warnings: [] }
