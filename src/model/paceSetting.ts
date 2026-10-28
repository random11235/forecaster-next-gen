import type { ThroughputRange } from '../engine/index.js'

export type { ThroughputRange }

/**
 * The pace the EM chose for a milestone: their manual range, or measured pace. Measured pace applies only while the
 * milestone has earned it (`minMeasuredPaceWeeks` of its own finished tickets); until then the manual range does.
 */
export type PaceMode = 'manual' | 'measured'

/** A milestone's pace, as stored. */
export interface PaceSetting {
  teamId: string
  milestoneId: string
  mode: PaceMode
  /** The EM's manual range of tickets per week, if entered. Kept when the EM switches to measured pace. */
  manual: ThroughputRange | undefined
}
