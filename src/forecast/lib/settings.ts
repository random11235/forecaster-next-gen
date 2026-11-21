import type { AmbiguityRanges } from '../../model/ambiguity.js'

/** Forecast settings; the single source of the defaults the design docs name. Not yet editable. */
export interface ForecastSettings {
  trials: number
  /** Confidence levels the Milestone forecast screen shows. */
  percentiles: number[]
  /** Horizon cap in periods of the milestone's cadence: trials still running after it finish "later than" the horizon date. */
  maxPeriods: number
  /** Fixed, so the same inputs always give the same forecast. */
  seed: number
  /**
   * How many typed counts of past periods the pace needs: fewer than `forForecast` give no forecast, and fewer than
   * `reliable` a forecast warned as shaky.
   */
  typedCounts: { forForecast: number; reliable: number }
}

export const DEFAULT_SETTINGS: ForecastSettings = {
  trials: 10_000,
  percentiles: [50, 70, 85, 95],
  maxPeriods: 156,
  seed: 1,
  typedCounts: { forForecast: 4, reliable: 8 },
}

/** Each ambiguity level's growth range until the EM edits them; medium is the default level. */
export const DEFAULT_AMBIGUITY_RANGES: Omit<AmbiguityRanges, 'teamId'> = {
  low: { low: 1, high: 1.5 },
  medium: { low: 1, high: 2 },
  high: { low: 1.5, high: 3 },
}
