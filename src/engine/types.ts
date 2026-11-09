export interface ScopeEntry {
  epicId: string
  rank: number
  /** Child count at commit; for an uncommitted epic, its current count (provisional). Null or 0: no children. */
  baseCount: number | null
  /** Children now, done or not. */
  currentCount: number
  doneCount: number
  /** Measured growth ratios (finalCount / committedCount) from finished epics, or the epic's ambiguity range. */
  growth: number[] | GrowthRange
}

/** A `low` to `high` span; the aliases below say what it counts and whether the ends are whole numbers. */
export interface NumberRange {
  low: number
  high: number
}

/** An ambiguity level's growth range: any ratio from `low` to `high`. */
export type GrowthRange = NumberRange

/** The default epic-size range: any whole number of tickets from `low` to `high`, both ends included. */
export type EpicSizeRange = NumberRange

/** The EM's manual pace: whole tickets per period, both ends included. */
export type ThroughputRange = NumberRange

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
  /** Final child counts of finished epics, or the default range; only used for epics with no children. */
  epicSizeSamples: number[] | EpicSizeRange
  /**
   * The team's capacity in each period from period 0, as a factor of its usual (1 = usual, 0.5 = half):
   * each trial multiplies the pace it draws for a period by that period's factor. Periods past the list's
   * end are at 1, and no list means every period is usual. Factors run from 0 to 10 (1000%).
   */
  capacity?: number[]
  /** The confidence levels to report as dates ('when') or counts ('howMany'): whole numbers from 0 to 100, no repeats, any order. */
  percentiles: number[]
}

export interface ForecastSpan {
  /** Periods to the median finish ('when', null beyond the horizon) or to `byDate` ('howMany'). */
  periods: number | null
  /** Median tickets across trials: remaining work after growth ('when'), or done by `byDate` ('howMany'). */
  tickets: number
}

export interface ForecastResult {
  caseHash: string
  /** 'when': finish period at p0..p100, null meaning beyond the horizon. 'howMany': items done by `byDate`. */
  quantiles: (number | null)[]
  /** 'when' only: the trials finishing in each period, from period 0 to the last finish within `maxPeriods`. */
  finishCounts: number[]
  /** Share of trials that finished within `maxPeriods`; 1 for 'howMany', whose trials always run to `byDate`. */
  finishedFraction: number
  /** 'when' only: ISO calendar dates, null meaning beyond the horizon. */
  percentileDates: Record<number, string | null>
  /** 'howMany' only: at least this many items get done in p% of trials. */
  percentileCounts: Record<number, number>
  /** 'when' only: each epic's finish period at p0..p100. */
  perEpic: { epicId: string; quantiles: (number | null)[] }[]
  diagnostics: {
    /**
     * Measured pace only, from 2 samples up: the relative standard error, sample sd / mean / √n.
     * Information for the EM (a wide but honest range), not a warning. 0 when every sample is 0.
     */
    paceVariation?: number
    /** Trials that hit `maxPeriods` without finishing; 0 for 'howMany'. */
    trialsHittingHorizon: number
    /** How far the forecast reaches: Seam B turns this into the long-forecast warning. */
    span: ForecastSpan
  }
}
