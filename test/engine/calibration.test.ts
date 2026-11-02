import { expect, test } from 'vitest'
import { ENGINE_VERSION, simulateCase, type SimulationCase } from '../../src/engine/index.js'
import { createRandom, type Random } from '../../src/engine/random.js'

// Steady teams, as in docs/research/pace-stability/ ("Short history makes every range too narrow"):
// each week's count is Poisson with mean 6, and the milestone has 60 tickets left.
const HISTORIES = 2_000
const WEEKS_OF_HISTORY = 10
const MEAN_PER_WEEK = 6
const TICKETS_REMAINING = 60
/** Enough trials for a stable P10 and P90 per forecast, few enough to keep the test to a few seconds. */
const TRIALS = 1000
const MAX_WEEKS = 200
/** Under 1s alone, but CI runs it with coverage on a slower runner, past vitest's 5s default. */
const TIMEOUT_MS = 30_000

/** One week's count from a steady team: Poisson with mean 6 (Knuth's method). */
function steadyWeek(random: Random): number {
  const limit = Math.exp(-MEAN_PER_WEEK)
  let count = -1
  let product = 1
  do {
    count++
    product *= random()
  } while (product > limit)
  return count
}

/** Weeks the team really takes to finish the milestone, going on at the same steady pace. */
function actualWeeks(random: Random): number {
  let remaining = TICKETS_REMAINING
  let weeks = 0
  while (remaining > 0) {
    remaining -= steadyWeek(random)
    weeks++
  }
  return weeks
}

function forecastFromTypedCounts(counts: number[], seed: number): SimulationCase {
  return {
    engineVersion: ENGINE_VERSION,
    seed,
    trials: TRIALS,
    maxPeriods: MAX_WEEKS,
    question: { kind: 'when' },
    startDate: '2026-01-05',
    periodDays: 7,
    scope: [
      {
        epicId: 'MILESTONE',
        rank: 1,
        baseCount: TICKETS_REMAINING,
        currentCount: TICKETS_REMAINING,
        doneCount: 0,
        growth: { low: 1, high: 1 },
      },
    ],
    throughputSamples: counts,
    epicSizeSamples: { low: 0, high: 0 },
    percentiles: [10, 90],
  }
}

// Research measured about 18% for the Bayesian bootstrap and about 26% for the plain one (ADR-0001).
// The band is loose on purpose: it only has to tell the two apart, and the fixed seeds keep it stable.
test('forecast ranges from 10 typed counts of a steady team miss the actual finish about 1 time in 5', () => {
  const team = createRandom(121)
  let misses = 0
  for (let history = 0; history < HISTORIES; history++) {
    const counts = Array.from({ length: WEEKS_OF_HISTORY }, () => steadyWeek(team))
    const { quantiles } = simulateCase(forecastFromTypedCounts(counts, history))
    const actual = actualWeeks(team)
    if (actual < quantiles[10]! || actual > quantiles[90]!) misses++
  }
  const missRate = misses / HISTORIES
  const guard =
    'Forecast ranges from typed counts have become too narrow or too wide: they should miss about 1 time in 5, ' +
    `but missed ${Math.round(missRate * 100)} times in 100. ` +
    'Typed counts should be drawn by the Bayesian bootstrap: docs/adr/0001-bayesian-bootstrap-pace-sampler.md.'

  expect(missRate, guard).toBeGreaterThanOrEqual(0.12)
  expect(missRate, guard).toBeLessThanOrEqual(0.24)
}, TIMEOUT_MS)
