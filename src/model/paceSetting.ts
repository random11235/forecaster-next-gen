import type { ThroughputRange } from '../engine/index.js'

export type { ThroughputRange }

/**
 * The pace a milestone's forecast uses: the EM's manual low–high range of tickets per week (set on the Inputs
 * screen), or the milestone's measured weekly pace once the EM has switched to it.
 */
export type Pace = ({ mode: 'manual' } & ThroughputRange) | { mode: 'measured' }

/** A milestone's pace, as stored. */
export type PaceSetting = { teamId: string; milestoneId: string } & Pace
