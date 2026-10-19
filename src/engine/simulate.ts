import { hashJson } from './hash.js'
import { createRandom, drawFrom } from './random.js'
import { PERCENTILES, type ForecastResult, type Percentile, type SimulationCase } from './types.js'
import { assertValidCase } from './validate.js'

const MS_PER_DAY = 86_400_000
/** Marks a trial that hit `maxPeriods` without finishing; sorts after every real period. */
const BEYOND_HORIZON = Number.POSITIVE_INFINITY

export function simulateCase(simulationCase: SimulationCase): ForecastResult {
  assertValidCase(simulationCase)
  const { trials, maxPeriods, scope, throughputSamples } = simulationCase
  const random = createRandom(simulationCase.seed)
  const finishPeriods = new Float64Array(trials)
  let finishedTrials = 0

  const epic = scope[0]!

  for (let trial = 0; trial < trials; trial++) {
    const total = epic.baseCount * drawFrom(random, epic.growth)
    let remaining = Math.max(total - epic.doneCount, 0)
    let period = 0
    while (remaining > 0 && period < maxPeriods) {
      period++
      remaining -= drawFrom(random, throughputSamples)
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
      return [p, q === null ? null : periodEndDate(simulationCase, q)]
    }),
  ) as Record<Percentile, string | null>

  return {
    caseHash: hashJson(simulationCase),
    quantiles,
    finishedFraction: finishedTrials / trials,
    percentileDates,
  }
}

/** Nearest-rank percentile of sorted values, for p in 0..100. */
function nearestRankPercentile(sorted: Float64Array, p: number): number {
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]!
}

function periodEndDate({ startDate, periodDays }: SimulationCase, period: number): string {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  return new Date(start + period * periodDays * MS_PER_DAY).toISOString().slice(0, 10)
}
