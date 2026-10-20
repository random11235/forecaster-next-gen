/** The confidence levels reported as dates ('when') or counts ('howMany'). */
export const PERCENTILES = [50, 85, 95] as const
export type Percentile = (typeof PERCENTILES)[number]

export interface ScopeEntry {
  epicId: string
  rank: number
  committed: boolean
  /** Child count at commit. */
  baseCount: number
  /** Children now, done or not. */
  currentCount: number
  doneCount: number
  /** Measured growth ratios (finalCount / committedCount) from finished epics, or the epic's ambiguity range. */
  growth: number[] | GrowthRange
}

/** An ambiguity level's growth range: any ratio from `low` to `high`. */
export interface GrowthRange {
  low: number
  high: number
}

/** The EM's manual pace: whole tickets per period, both ends included. */
export interface ThroughputRange {
  low: number
  high: number
}

export interface SimulationCase {
  engineVersion: string
  seed: number
  trials: number
  /** Horizon cap, counted in periods of `periodDays`. */
  maxPeriods: number
  question: { kind: 'when' } | { kind: 'howMany'; /** ISO calendar date, `YYYY-MM-DD`. */ byDate: string }
  /** ISO calendar date, `YYYY-MM-DD`. */
  startDate: string
  periodDays: number
  scope: ScopeEntry[]
  /** Measured done counts per period, or the EM's manual range. */
  throughputSamples: number[] | ThroughputRange
}

export interface ForecastResult {
  caseHash: string
  /** 'when': finish period at p0..p100, null meaning beyond the horizon. 'howMany': items done by `byDate`. */
  quantiles: (number | null)[]
  /** Share of trials that finished within `maxPeriods`; 1 for 'howMany', whose trials always run to `byDate`. */
  finishedFraction: number
  /** 'when' only: ISO calendar dates, null meaning beyond the horizon. */
  percentileDates: Partial<Record<Percentile, string | null>>
  /** 'howMany' only: at least this many items get done in p% of trials. */
  percentileCounts: Partial<Record<Percentile, number>>
  /** 'when' only: each epic's finish period at p0..p100. */
  perEpic: { epicId: string; quantiles: (number | null)[] }[]
  diagnostics: {
    throughputSource: 'manual' | 'measured'
  }
}
