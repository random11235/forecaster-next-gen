import { periodEndDate, wholePeriodsUntil } from './dates.js'
import { hashJson } from './hash.js'
import { createRandom, drawFrom, drawWholeNumberIn, type Random } from './random.js'
import { PERCENTILES, type ForecastResult, type Percentile, type SimulationCase, type ThroughputRange } from './types.js'
import { assertValidCase } from './validate.js'

/** Marks a trial that hit `maxPeriods` without finishing; sorts after every real period. */
const BEYOND_HORIZON = Number.POSITIVE_INFINITY

type QuestionResult = Pick<ForecastResult, 'quantiles' | 'finishedFraction' | 'percentileDates' | 'percentileCounts' | 'perEpic'>

export function simulateCase(simulationCase: SimulationCase): ForecastResult {
  assertValidCase(simulationCase)
  const { question, throughputSamples } = simulationCase
  const random = createRandom(simulationCase.seed)
  const result =
    question.kind === 'when'
      ? simulateWhen(simulationCase, random)
      : simulateHowMany(simulationCase, question.byDate, random)

  return {
    caseHash: hashJson(simulationCase),
    ...result,
    diagnostics: { throughputSource: isRange(throughputSamples) ? 'manual' : 'measured' },
  }
}

function simulateWhen(simulationCase: SimulationCase, random: Random): QuestionResult {
  const { trials, maxPeriods, scope, throughputSamples } = simulationCase
  const finishPeriods = new Float64Array(trials)
  let finishedTrials = 0

  const epic = scope[0]!

  for (let trial = 0; trial < trials; trial++) {
    const total = withoutFloatError(epic.baseCount * drawFrom(random, epic.growth))
    let remaining = Math.max(total - epic.doneCount, 0)
    let period = 0
    while (remaining > 0 && period < maxPeriods) {
      period++
      remaining -= drawThroughput(random, throughputSamples)
    }
    if (remaining > 0) {
      finishPeriods[trial] = BEYOND_HORIZON
    } else {
      finishPeriods[trial] = period
      finishedTrials++
    }
  }

  finishPeriods.sort()
  const quantiles = Array.from({ length: 101 }, (_, p) => {
    const q = nearestRankPercentile(finishPeriods, p)
    return q === BEYOND_HORIZON ? null : q
  })
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
    perEpic: [{ epicId: epic.epicId, quantiles }],
  }
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

function isRange(throughput: readonly number[] | ThroughputRange): throughput is ThroughputRange {
  return !Array.isArray(throughput)
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
