import type { GrowthRange } from '../engine/index.js'

export type { GrowthRange }

/** How well the EM judges the work is understood: the less, the more it may grow. */
export type Ambiguity = 'low' | 'medium' | 'high'

export const AMBIGUITIES: readonly Ambiguity[] = ['low', 'medium', 'high']

/** The growth range of each ambiguity level, editable by the EM. One per team. */
export interface AmbiguityRanges {
  teamId: string
  low: GrowthRange
  medium: GrowthRange
  high: GrowthRange
}
