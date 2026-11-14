import type { ThroughputRange } from '../engine/index.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import { addDays, daysBetween } from './calendarDate.js'
import { withAction, type DatedCounts } from './paceWindow.js'
import type { Measured, PaceReading } from './trackerReads.js'

/** The counts pace is drawn from: `all` of them, and `window`, those left once the milestone's pace action is applied. */
export interface PaceCounts {
  all: DatedCounts
  window: DatedCounts
}

/**
 * The pace the milestone's forecast uses, from the source the EM chose: the range (none until one is entered), the
 * typed counts, or the counts the connected `tracker` reads. Following the tracker, its `reading`, none until a
 * complete read reaches a whole period (`incomplete` when a read it would come from is incomplete), and the counts
 * that reading gives, none without one.
 */
export type PaceInUse =
  | { source: 'range'; range: ThroughputRange | undefined }
  | ({ source: 'counts' } & PaceCounts)
  | ({ source: 'tracker'; tracker: string; reading: PaceReading | undefined; incomplete: boolean } & PaceCounts)

/**
 * The pace in use for the milestone on `today`, with what the team's tracker measures (`measured`; none with no
 * connection, when following the tracker falls back to the typed counts). Each view works it out once, and every part
 * of the view that shows pace takes it from there.
 */
export function paceInUse(inputs: MilestoneInputs, today: string, measured: Measured | undefined): PaceInUse {
  if (inputs.paceMode === 'range') return { source: 'range', range: inputs.paceRange }
  if (inputs.paceMode === 'tracker' && measured) {
    const reading = measured.pace
    const all = reading?.window ?? { counts: [], starts: [] }
    return { source: 'tracker', tracker: measured.tracker, reading, incomplete: measured.paceIncomplete, ...withActionApplied(inputs, all) }
  }
  return { source: 'counts', ...withActionApplied(inputs, typedCounts(inputs, today)) }
}

/** `all`, and the window the milestone's pace action leaves of them; all of them with none applied, or no start date. */
function withActionApplied(inputs: MilestoneInputs, all: DatedCounts): PaceCounts {
  const action = inputs.paceWindow.action
  if (action === undefined || inputs.startDate === undefined) return { all, window: all }
  return { all, window: withAction(all, action) }
}

/** The milestone's typed counts, dated back from the current period on `today`. */
function typedCounts(inputs: MilestoneInputs, today: string): DatedCounts {
  const counts = inputs.paceCounts
  const starts = inputs.startDate === undefined ? [] : typedCountStarts(counts.length, inputs.startDate, inputs.cadenceDays, today)
  return { counts: [...counts], starts }
}

/**
 * The first day of each typed count's period, oldest first. They are dated back from the current period (the one
 * holding `today`, in periods counted from the start date): the last count is the most recent whole period.
 */
function typedCountStarts(counts: number, startDate: string, periodDays: number, today: string): string[] {
  const current = Math.floor(daysBetween(startDate, today) / periodDays)
  return Array.from({ length: counts }, (_, count) => addDays(startDate, (current - counts + count) * periodDays))
}
