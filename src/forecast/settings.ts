import type { EpicSizeRange } from '../engine/index.js'
import type { AmbiguityRanges } from '../model/ambiguity.js'

/** Forecast settings; the single source of the defaults the design docs name. Not yet editable. */
export interface ForecastSettings {
  trials: number
  /** Confidence levels the Milestone forecast screen shows. */
  percentiles: number[]
  periodDays: number
  /** Horizon cap in periods: trials still running after it finish "later than" the horizon date. */
  maxPeriods: number
  /** Fixed, so the same inputs always give the same forecast. */
  seed: number
  /** Weeks of the milestone's own finished tickets before measured pace is offered. */
  minMeasuredPaceWeeks: number
  /** Growth samples needed before the measured medium range is suggested. */
  minGrowthSamples: number
  /** Size of an epic with no children, until finished epics give samples. Provisional. */
  defaultEpicSize: EpicSizeRange
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  trials: 10_000,
  percentiles: [50, 70, 85, 95],
  periodDays: 7,
  maxPeriods: 156,
  seed: 1,
  minMeasuredPaceWeeks: 8,
  minGrowthSamples: 7,
  defaultEpicSize: { low: 5, high: 15 },
}

/** Each ambiguity level's growth range until the EM edits them; medium is the default level. */
export const DEFAULT_AMBIGUITY_RANGES: Omit<AmbiguityRanges, 'teamId'> = {
  low: { low: 1, high: 1.5 },
  medium: { low: 1, high: 2 },
  high: { low: 1.5, high: 3 },
  mediumMeasured: false,
}
