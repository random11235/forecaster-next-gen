export type Percentile = 50 | 85 | 95

export interface ScopeEntry {
  epicId: string
  rank: number
  committed: boolean
  /** Child count at commit. */
  baseCount: number
  /** Children now, done or not. */
  currentCount: number
  doneCount: number
  /** Measured growth ratios (finalCount / committedCount) from finished epics. */
  growth: number[]
}

export interface SimulationCase {
  engineVersion: string
  seed: number
  trials: number
  /** Horizon cap, counted in periods of `periodDays`. */
  maxPeriods: number
  question: { kind: 'when' }
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate: string
  periodDays: number
  scope: ScopeEntry[]
  /** Measured done counts per period. */
  throughputSamples: number[]
}

export interface ForecastResult {
  caseHash: string
  /** Finish period at p0..p100; null means beyond the horizon. */
  quantiles: (number | null)[]
  /** Share of trials that finished within `maxPeriods`. */
  finishedFraction: number
  /** ISO calendar dates; null means beyond the horizon. */
  percentileDates: Record<Percentile, string | null>
}
