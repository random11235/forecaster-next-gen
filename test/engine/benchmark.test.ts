import { expect, test } from 'vitest'
import { simulateCase, type SimulationCase } from '../../src/engine/index.js'

/** About 100 ms is the budget from the design ("Language choice"); revisit the engine's language only if this fails. */
const BUDGET_MS = 100
/** Shared CI runners are noisy, so the best of several runs is timed, after a warm-up run for the JIT. */
const TIMED_RUNS = 5

// A realistic milestone: 10 epics of about a dozen tickets each, growing by measured ratios,
// at a measured weekly pace, with a 30-week horizon that most trials finish within.
const realisticCase: SimulationCase = {
  engineVersion: '1',
  seed: 7,
  trials: 10_000,
  maxPeriods: 30,
  question: { kind: 'when' },
  startDate: '2026-01-05',
  periodDays: 7,
  scope: Array.from({ length: 10 }, (_, i) => ({
    epicId: `EPIC-${i + 1}`,
    rank: i + 1,
    committed: i < 8,
    baseCount: i === 9 ? null : 8 + (i % 4) * 2,
    currentCount: i === 9 ? 0 : 10 + (i % 4) * 2,
    doneCount: i < 2 ? 6 : 0,
    growth: i % 3 === 0 ? { low: 1, high: 2 } : [1, 1.1, 1.25, 1.4, 1.5, 1.8, 2, 2.6],
  })),
  throughputSamples: [3, 5, 6, 4, 8, 7, 2, 6, 9, 5, 6, 4],
  epicSizeSamples: [6, 9, 12, 15, 20],
  percentiles: [50, 70, 85, 95],
}

test(`10,000 trials over a realistic case finish within about ${BUDGET_MS} ms`, () => {
  const warmUp = simulateCase(realisticCase)
  expect(warmUp.finishedFraction).toBeGreaterThan(0.5)

  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < TIMED_RUNS; run++) {
    const start = performance.now()
    simulateCase(realisticCase)
    best = Math.min(best, performance.now() - start)
  }

  expect(best).toBeLessThan(BUDGET_MS)
})
