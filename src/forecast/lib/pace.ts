import type { SavedRead } from '../../model/savedRead.js'
import type { ForecastSettings } from '../settings.js'
import { inUseOf, notesOf, type ChosenPace, type PaceInUse, type PaceNote, type PaceWarning } from './paceInUse.js'
import { readingOf, type PaceReading } from './paceReading.js'
import { finishedPerPeriod, sideBySide, wholePeriods, type DatedCounts, type PaceLaying, type SavedPaceReads, type SideBySide } from './periodCounts.js'

export { actionSaid, withAction, type PaceCounts, type PaceInUse } from './paceInUse.js'
export { sameCounts, type PaceReading, type WasPace } from './paceReading.js'
export { calendarDayIn, savedPaceReads, type DatedCounts, type PaceClock, type PaceFrom, type SavedPaceReads } from './periodCounts.js'
export { finishedSinceFor, readQuery, ticketsRemaining, weeksRead, type QueryRead } from './queryRead.js'

// Pace, worked out in one place (#243): `paceOf` is the way in, and the only import its callers use. Behind it, its
// sibling files: the reads counted per period side by side (periodCounts.ts), the tracker's window (trackerWindow.ts)
// and reading (paceReading.ts), the pace in use and its notes (paceInUse.ts), and reading a query (queryRead.ts).

/**
 * What pace is measured from: the team's saved reads, with the connected `tracker` that the reading's lines name (none,
 * as in the Comparable work step, which shows no reading) and, for a view, the source the EM `chosen`; with no
 * tracker connected, the chosen source alone; or a candidate's read, kept only by its opening.
 */
export type PaceMeasuring = { saved: SavedPaceReads; tracker?: string; chosen?: ChosenPace } | { chosen: ChosenPace } | { candidate: SavedRead }

/**
 * What `paceOf` measures pace from (`reads`), and on what: the milestone's pace window (its skipped periods and the
 * pace action applied), its cadence in days, its start date (a candidate is laid from today without one), and today
 * in the EM's time zone (`clock`). With a source `chosen`, the `settings` its notes are judged against.
 */
export type PaceOf = PaceLaying &
  ({ reads: PaceMeasuring & { chosen: ChosenPace }; settings: Pick<ForecastSettings, 'typedCounts'> } | { reads: PaceMeasuring; settings?: undefined })

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
 * Seam B, behind the views, the Comparable work step and its candidates: pace measured from `reads`. Once a
 * comparable-work query is added and its read finished something, pace comes from comparable work's finished tickets
 * alone; with no query, or one matching nothing finished in the periods counted, from the milestone's own, over the
 * periods since its start date. Each read's tickets count once by id, on its calendar day in the EM's time zone. A
 * read that is incomplete isn't counted: the milestone query's leaves its own counts unknown, but not a pace from
 * comparable work.
 */
export function paceOf(of: PaceOf & { reads: { chosen: ChosenPace } }): ChosenSourcePace
export function paceOf(of: PaceOf): Pace
export function paceOf(of: PaceOf): Pace {
  const { reads } = of
  if ('candidate' in reads) {
    const laid = { ...of, startDate: of.startDate ?? of.clock.today }
    const { periods } = wholePeriods([reads.candidate], laid)
    return { ...NO_PACE, counts: finishedPerPeriod(reads.candidate, { ...laid, periods }) }
  }
  const saved = 'saved' in reads ? reads.saved : undefined
  const tracker = 'saved' in reads ? reads.tracker : undefined
  const sides = saved && sideBySide(saved, of)
  const reading = saved && sides && tracker !== undefined ? readingOf(saved, sides, tracker, of) : undefined
  const incomplete = !reading && [saved?.milestone?.latest, saved?.comparableWork?.latest].some((read) => read?.incomplete === true)
  const measured = { counts: sides?.counts, sideBySide: sides?.sides, reading, incomplete }
  if (!reads.chosen || !of.settings) return { ...NO_PACE, ...measured }
  const inUse = inUseOf(reads.chosen, tracker !== undefined ? { tracker, reading, incomplete } : undefined, of)
  return { ...measured, inUse, ...notesOf(inUse, of, of.settings) }
}

const NO_PACE: Pace = { counts: undefined, sideBySide: undefined, reading: undefined, incomplete: false, inUse: undefined, problems: [], warnings: [] }
