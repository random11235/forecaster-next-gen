/** The confidence levels reported as dates ('when') or counts ('howMany'). */
export const PERCENTILES = [50, 85, 95] as const
export type Percentile = (typeof PERCENTILES)[number]

export interface ScopeEntry {
  epicId: string
  rank: number
  committed: boolean
  /** Child count at commit; for an uncommitted epic, its current count (provisional). Null or 0: no children. */
  baseCount: number | null
  /** Children now, done or not. */
  currentCount: number
  doneCount: number
  /** Measured growth ratios (finalCount / committedCount) from finished epics, or the epic's ambiguity range. */
  growth: number[] | GrowthRange
}

/** Where an epic's total comes from: measured growth samples, its ambiguity range, or a drawn epic size (no children). */
export type GrowthSource = 'samples' | 'ambiguity' | 'epic_size'

/** Which tickets a pace sample counts; later scopes (any epic's children, all work) join this union. */
export type ThroughputScope = 'milestone_epics'

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
    /** Which tickets the pace counts: in v1, only children of the milestone's epics. */
    throughputScope: ThroughputScope
    throughputSource: 'manual' | 'measured'
    /** Each epic's growth source, in rank order. */
    growthSource: { epicId: string; source: GrowthSource }[]
    /** Epics forecast from a provisional baseCount, in rank order; shown as "not committed: wide range". */
    uncommittedEpicIds: string[]
  }
}
