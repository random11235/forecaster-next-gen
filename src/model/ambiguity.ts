import type { GrowthRange } from '../engine/index.js'

export type { GrowthRange }

/** How well the EM judges an epic is understood: the less, the more it may grow. */
export type Ambiguity = 'low' | 'medium' | 'high'

export const AMBIGUITIES: readonly Ambiguity[] = ['low', 'medium', 'high']

/** The growth range of each ambiguity level, editable by the EM. One per team. */
export interface AmbiguityRanges {
  teamId: string
  low: GrowthRange
  medium: GrowthRange
  high: GrowthRange
  /**
   * The EM adopted the measured growth for medium: epics of medium ambiguity draw from the team's growth samples
   * instead of the medium range, while enough samples exist.
   */
  mediumMeasured: boolean
}

/** The EM's ambiguity level for one of a milestone's epics; an epic without one is of medium ambiguity. */
export interface EpicAmbiguity {
  teamId: string
  milestoneId: string
  epicId: string
  ambiguity: Ambiguity
}
