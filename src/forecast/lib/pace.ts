import type { SavedRead } from '../../model/savedRead.js'
import type { ForecastSettings } from '../settings.js'
import { inUseOf, notesOf, type ChosenPace, type PaceInUse, type PaceNote, type PaceWarning } from './paceInUse.js'
import { readingOf, type PaceReading } from './paceReading.js'
import { finishedPerPeriod, sideBySide, wholePeriods, type DatedCounts, type PaceCalendar, type SavedPaceReads, type SideBySide } from './periodCounts.js'

export { actionSaid, withAction, type PaceCounts, type PaceInUse } from './paceInUse.js'
export { sameCounts, type PaceReading, type WasPace } from './paceReading.js'
export { calendarDayIn, completeRead, paceCalendar, savedPaceReads, type DatedCounts, type PaceFrom, type SavedPaceReads } from './periodCounts.js'
export { TRACKER_PERIODS } from './trackerWindow.js'

// Pace, worked out in one place (#243): `paceOf` is the way in, and this file the only import pace's callers use.
// Behind it, its sibling files: the reads counted per period side by side (periodCounts.ts), the tracker's window
// (trackerWindow.ts) and reading (paceReading.ts), and the pace in use and its notes (paceInUse.ts). Reading a query
// is not pace: it has its own entry point, `forecast/queryRead.ts`.

/**
 * The reads pace is counted from, with the EM's time zone (an IANA name) each finish is counted on its calendar day
 * in: the team's saved reads, with the connected `tracker` that the reading's lines name (none, as in the Comparable
 * work step, which shows no reading); or a candidate's read, kept only by its opening.
 */
export type PaceReads = { saved: SavedPaceReads; tracker?: string; timeZone: string } | { candidate: SavedRead; timeZone: string }

/**
 * What `paceOf` works pace out from: the milestone's calendar, and the `reads` pace is counted from (none with no
 * tracker connected). With a source `chosen`, the `settings` its notes are judged against, always both or neither.
 */
export type PaceInputs = PaceCalendar & { reads?: PaceReads | undefined } & (
    { chosen: ChosenPace; settings: Pick<ForecastSettings, 'typedCounts'> } | { chosen?: undefined; settings?: undefined }
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
export function paceOf(of: PaceInputs & { chosen: ChosenPace }): ChosenSourcePace
export function paceOf(of: PaceInputs): Pace
export function paceOf(of: PaceInputs): Pace {
  const { reads } = of
  if (reads && 'candidate' in reads) {
    const laid = { ...of, startDate: of.startDate ?? of.today, timeZone: reads.timeZone }
    const { periods } = wholePeriods([reads.candidate], laid)
    return { ...NO_PACE, counts: finishedPerPeriod(reads.candidate, { ...laid, periods }) }
  }
  const counted = reads && { saved: reads.saved, on: { ...of, timeZone: reads.timeZone } }
  const tracker = reads?.tracker
  const sides = counted && sideBySide(counted.saved, counted.on)
  const reading = counted && sides && tracker !== undefined ? readingOf(counted.saved, sides, tracker, counted.on) : undefined
  const incomplete = !reading && [reads?.saved.milestone?.latest, reads?.saved.comparableWork?.latest].some((read) => read?.incomplete === true)
  const measured = { counts: sides?.counts, sideBySide: sides?.sides, reading, incomplete }
  if (!of.chosen) return { ...NO_PACE, ...measured }
  const inUse = inUseOf(of.chosen, tracker !== undefined ? { tracker, reading, incomplete } : undefined, of)
  return { ...measured, inUse, ...notesOf(inUse, of, of.settings) }
}

const NO_PACE: Pace = { counts: undefined, sideBySide: undefined, reading: undefined, incomplete: false, inUse: undefined, problems: [], warnings: [] }
