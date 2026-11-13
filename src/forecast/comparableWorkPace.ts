import type { MilestoneQueryStorage, SavedReadStorage, Storage } from '../storage/storage.js'
import { periodName } from './cadence.js'
import { comparedWithOwn, comparisonSaid, median, perPeriod, type PaceComparison } from './paceComparison.js'
import { paceReads, type PaceDay, type PaceFrom } from './paceReads.js'

/** The pace in use: where it comes from, and its median and range a period. */
export interface PaceInUse {
  from: PaceFrom
  median: number
  low: number
  high: number
}

/**
 * What the Comparable work step leads with: the pace in use, and how far it is from the milestone's own so far, each
 * also as the step says it.
 */
export interface ComparableWorkPace {
  /** None until pace has a period to count. */
  inUse?: PaceInUse
  /** How the pace in use compares with the milestone's own; none when it is the milestone's own. */
  comparison?: PaceComparison
  said: {
    /** "2 a week". */
    inUse?: string
    /** "pace, from comparable work, range 1–2". */
    from?: string
    /** "↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)". */
    comparison?: string
  }
}

/**
 * Seam B: the Comparable work step's pace, from the team's saved reads (`paceReads`), asking the tracker nothing.
 * None before the milestone has a start date and a complete read of its query.
 */
export function comparableWorkPace(storage: Storage & MilestoneQueryStorage & SavedReadStorage, teamId: string, day: PaceDay): ComparableWorkPace | undefined {
  const reads = paceReads(storage, teamId, day)
  const inputs = storage.milestoneInputs(teamId)
  if (!reads || !inputs) return undefined
  const period = periodName(inputs.cadenceDays)
  const counts = reads.pace.counts
  const inUse: PaceInUse | undefined =
    counts.length === 0 ? undefined : { from: reads.from, median: median(counts), low: Math.min(...counts), high: Math.max(...counts) }
  const own = reads.milestone.counts.slice(reads.beforeStart)
  const comparison = reads.from === 'comparableWork' ? comparedWithOwn(counts, own) : undefined
  return {
    ...(inUse && { inUse }),
    ...(comparison && { comparison }),
    said: {
      ...(inUse && { inUse: perPeriod(inUse.median, period), from: `pace, from ${FROM_SAID[inUse.from]}, range ${range(inUse)}` }),
      ...(comparison && { comparison: comparisonSaid(comparison, period) }),
    },
  }
}

const FROM_SAID: Readonly<Record<PaceFrom, string>> = { comparableWork: 'comparable work', milestone: 'the milestone’s own tickets' }

/** "1–2", or "2" when the range is one count. */
function range({ low, high }: PaceInUse): string {
  return low === high ? `${low}` : `${low}–${high}`
}
