import type { EpicSizeRange, GrowthRange } from '../engine/index.js'

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
  /** Growth range for an epic of medium ambiguity, the default level. */
  mediumAmbiguity: GrowthRange
  /** Size of an epic with no children, until finished epics give samples. Provisional. */
  defaultEpicSize: EpicSizeRange
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  trials: 10_000,
  percentiles: [50, 85, 95],
  periodDays: 7,
  maxPeriods: 156,
  seed: 1,
  mediumAmbiguity: { low: 1, high: 2 },
  defaultEpicSize: { low: 5, high: 15 },
}
