import { periodEndDate, wholePeriodsUntil } from './dates.js'
import { hashJson } from './hash.js'
import { createRandom, drawFrom, drawWholeNumberIn, type Random } from './random.js'
import { PERCENTILES, type EpicSizeRange, type ForecastResult, type GrowthRange, type Percentile, type SimulationCase, type ThroughputRange } from './types.js'
import { assertValidCase } from './validate.js'

/** Marks a trial that hit `maxPeriods` without finishing; sorts after every real period. */
const BEYOND_HORIZON = Number.POSITIVE_INFINITY

type QuestionResult = Pick<ForecastResult, 'quantiles' | 'finishedFraction' | 'percentileDates' | 'percentileCounts' | 'perEpic'>

export function simulateCase(simulationCase: SimulationCase): ForecastResult {
  assertValidCase(simulationCase)
  const { question, scope, throughputSamples } = simulationCase
  const ranked = [...scope].sort((a, b) => a.rank - b.rank)
  const random = createRandom(simulationCase.seed)
  const result =
    question.kind === 'when'
      ? simulateWhen(simulationCase, random)
      : simulateHowMany(simulationCase, question.byDate, random)

  return {
    caseHash: hashJson(simulationCase),
    ...result,
    diagnostics: {
      throughputSource: isRange(throughputSamples) ? 'manual' : 'measured',
      uncommittedEpicIds: ranked.filter((epic) => !epic.committed).map((epic) => epic.epicId),
    },
  }
}

function simulateWhen(simulationCase: SimulationCase, random: Random): QuestionResult {
  const { trials, maxPeriods, scope, throughputSamples, epicSizeSamples } = simulationCase
  const ranked = [...scope].sort((a, b) => a.rank - b.rank)
  const growthAt = ranked.map((epic) => growthRatioAt(epic.growth))
  const remaining = new Float64Array(ranked.length)
  const epicFinishPeriods = ranked.map(() => new Float64Array(trials))
  const finishPeriods = new Float64Array(trials)
  let finishedTrials = 0

  for (let trial = 0; trial < trials; trial++) {
    // One draw for the whole trial: a milestone's epics tend to over-run together
    const u = random()
    for (let i = 0; i < ranked.length; i++) {
      const epic = ranked[i]!
      const drawn = hasChildren(epic.baseCount)
        ? withoutFloatError(epic.baseCount * growthAt[i]!(u))
        : drawEpicSize(random, epicSizeSamples)
      const total = Math.max(drawn, epic.currentCount)
      remaining[i] = Math.max(total - epic.doneCount, 0)
      if (remaining[i] === 0) epicFinishPeriods[i]![trial] = 0
    }

    // `next` is the first ranked epic with work left; epics before it have finished
    let next = skipFinished(remaining, 0)
    let period = 0
    while (next < ranked.length && period < maxPeriods) {
      period++
      let throughput = drawThroughput(random, throughputSamples)
      while (throughput > 0 && next < ranked.length) {
        const burned = Math.min(throughput, remaining[next]!)
        remaining[next]! -= burned
        throughput -= burned
        if (remaining[next] === 0) {
          epicFinishPeriods[next]![trial] = period
          next = skipFinished(remaining, next + 1)
        }
      }
    }
    for (let i = next; i < ranked.length; i++) {
      if (remaining[i]! > 0) epicFinishPeriods[i]![trial] = BEYOND_HORIZON
    }

    if (next < ranked.length) {
      finishPeriods[trial] = BEYOND_HORIZON
    } else {
      finishPeriods[trial] = period
      finishedTrials++
    }
  }

  const quantiles = finishQuantiles(finishPeriods)
  const percentileDates = Object.fromEntries(
    PERCENTILES.map((p) => {
      const q = quantiles[p]!
      return [p, q === null ? null : periodEndDate(simulationCase.startDate, simulationCase.periodDays, q)]
    }),
  ) as Record<Percentile, string | null>

  return {
    quantiles,
    finishedFraction: finishedTrials / trials,
    percentileDates,
    percentileCounts: {},
    perEpic: ranked.map((epic, i) => ({ epicId: epic.epicId, quantiles: finishQuantiles(epicFinishPeriods[i]!) })),
  }
}

/**
 * An epic's growth ratio at quantile `u` in [0, 1): the empirical quantile of its samples,
 * each covering an equal share of [0, 1), or `low + u × (high − low)` for a range.
 */
function growthRatioAt(growth: readonly number[] | GrowthRange): (u: number) => number {
  if (isRange(growth)) {
    const { low, high } = growth
    return (u) => low + u * (high - low)
  }
  const sorted = Float64Array.from(growth).sort()
  return (u) => sorted[Math.floor(u * sorted.length)]!
}

/** A null or 0 baseCount means the epic has no children, so a growth ratio has nothing to scale. */
function hasChildren(baseCount: number | null): baseCount is number {
  return baseCount !== null && baseCount > 0
}

/** An empty epic's total size, drawn independently of the trial's shared growth quantile. */
function drawEpicSize(random: Random, epicSize: readonly number[] | EpicSizeRange): number {
  return isRange(epicSize) ? drawWholeNumberIn(random, epicSize.low, epicSize.high) : drawFrom(random, epicSize)
}

/** The index of the first epic from `from` on with work remaining, or the epic count if none has. */
function skipFinished(remaining: Float64Array, from: number): number {
  let i = from
  while (i < remaining.length && remaining[i] === 0) i++
  return i
}

/** 101 quantiles of finish periods, null where a quantile lands beyond the horizon. Sorts in place. */
function finishQuantiles(finishPeriods: Float64Array): (number | null)[] {
  finishPeriods.sort()
  return Array.from({ length: 101 }, (_, p) => {
    const q = nearestRankPercentile(finishPeriods, p)
    return q === BEYOND_HORIZON ? null : q
  })
}

function simulateHowMany(simulationCase: SimulationCase, byDate: string, random: Random): QuestionResult {
  const { trials, startDate, periodDays, throughputSamples } = simulationCase
  const periods = wholePeriodsUntil(startDate, periodDays, byDate)
  const doneCounts = new Float64Array(trials)

  for (let trial = 0; trial < trials; trial++) {
    let done = 0
    for (let period = 0; period < periods; period++) done += drawThroughput(random, throughputSamples)
    doneCounts[trial] = done
  }

  doneCounts.sort()
  const quantiles = Array.from({ length: 101 }, (_, p) => nearestRankPercentile(doneCounts, p))
  // "p% sure" means at least this many get done in p% of trials: the (100 − p)th percentile
  const percentileCounts = Object.fromEntries(PERCENTILES.map((p) => [p, quantiles[100 - p]!])) as Record<
    Percentile,
    number
  >

  return { quantiles, finishedFraction: 1, percentileDates: {}, percentileCounts, perEpic: [] }
}

/** One period's done count: a bootstrap draw from measured samples, or a whole number from the manual range. */
function drawThroughput(random: Random, throughput: readonly number[] | ThroughputRange): number {
  return isRange(throughput) ? drawWholeNumberIn(random, throughput.low, throughput.high) : drawFrom(random, throughput)
}

function isRange<Range extends ThroughputRange | GrowthRange | EpicSizeRange>(value: readonly number[] | Range): value is Range {
  return !Array.isArray(value)
}

/** Rounds to 9 decimal places: clears float noise (100 × 1.1) but keeps real fractions (12.5). */
function withoutFloatError(value: number): number {
  return Math.round(value * 1e9) / 1e9
}

/** Nearest-rank percentile of sorted values, for p in 0..100. */
function nearestRankPercentile(sorted: Float64Array, p: number): number {
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]!
}
