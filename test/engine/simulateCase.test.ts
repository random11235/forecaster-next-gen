import { describe, expect, test } from 'vitest'
import { periodEndDate, simulateCase, type ScopeEntry, type SimulationCase } from '../../src/engine/index.js'

function epic(overrides: Partial<ScopeEntry> = {}): ScopeEntry {
  return {
    epicId: 'EPIC-1',
    rank: 1,
    committed: true,
    baseCount: 10,
    currentCount: 10,
    doneCount: 0,
    growth: [1],
    ...overrides,
  }
}

function whenCase(overrides: Partial<SimulationCase> = {}): SimulationCase {
  return {
    engineVersion: '1',
    seed: 42,
    trials: 1_000,
    maxPeriods: 156,
    question: { kind: 'when' },
    startDate: '2026-01-05',
    periodDays: 7,
    scope: [epic()],
    throughputSamples: [2],
    epicSizeSamples: [8],
    ...overrides,
  }
}

describe("simulateCase: 'when' for one committed epic", () => {
  test('a fixed pace finishes the epic in a known period, at every quantile', () => {
    const result = simulateCase(whenCase())

    expect(result.quantiles).toHaveLength(101)
    expect(result.quantiles.every((q) => q === 5)).toBe(true)
    expect(result.finishedFraction).toBe(1)
    expect(result.percentileDates).toEqual({
      50: '2026-02-09',
      85: '2026-02-09',
      95: '2026-02-09',
    })
  })

  test("the epic's total is baseCount times its growth ratio, less what is already done", () => {
    // 10 × 1.5 = 15 total, 3 done, 12 remaining at 2 per period → 6 periods
    const result = simulateCase(whenCase({ scope: [epic({ growth: [1.5], doneCount: 3 })] }))

    expect(result.quantiles[50]).toBe(6)
  })

  test("floating-point error in the epic's total does not add a period", () => {
    // 100 × 1.1 is 110.00000000000001 in floating point; 110 per period finishes it in one
    const result = simulateCase(
      whenCase({ scope: [epic({ baseCount: 100, growth: [1.1] })], throughputSamples: [110] }),
    )

    expect(result.quantiles.every((q) => q === 1)).toBe(true)
  })

  test("a drawn total is never below the epic's current count", () => {
    // 10 × 1 = 10 drawn, but 16 tickets already exist: 16 at 2 per period → 8 periods
    const result = simulateCase(whenCase({ scope: [epic({ currentCount: 16 })] }))

    expect(result.quantiles.every((q) => q === 8)).toBe(true)
  })

  test('an epic with more done than its drawn total has no remaining work', () => {
    // 10 × 0.5 = 5 total, but 8 tickets exist and all are done
    const result = simulateCase(whenCase({ scope: [epic({ growth: [0.5], currentCount: 8, doneCount: 8 })] }))

    expect(result.quantiles.every((q) => q === 0)).toBe(true)
    expect(result.percentileDates[95]).toBe('2026-01-05')
  })

  test('each period draws one throughput value, with replacement, from the measured samples', () => {
    // One ticket left; each period finishes it with probability 1/2, so the finish
    // period is geometric: P(≤1) = 0.5, P(≤2) = 0.75, P(≤3) = 0.875.
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [epic({ baseCount: 1, currentCount: 1 })],
        throughputSamples: [0, 1],
      }),
    )

    expect(result.quantiles[40]).toBe(1)
    expect(result.quantiles[60]).toBe(2)
    expect(result.quantiles[80]).toBe(3)
  })

  test("the growth ratio is drawn from the epic's growth samples", () => {
    // 10 × 1 = 10 or 10 × 3 = 30 tickets at 10 per period: period 1 or 3, about half each
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [epic({ growth: [1, 3] })],
        throughputSamples: [10],
      }),
    )

    expect(result.quantiles[0]).toBe(1)
    expect(result.quantiles[40]).toBe(1)
    expect(result.quantiles[60]).toBe(3)
    expect(result.quantiles[100]).toBe(3)
  })

  test("a growth range draws the ratio uniformly from low to high", () => {
    // 10 × [1, 3] is a total spread evenly over 10 to 30; at 1 per period, so are the finish periods
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [epic({ growth: { low: 1, high: 3 } })],
        throughputSamples: [1],
      }),
    )

    expect(result.quantiles[0]).toBeGreaterThanOrEqual(10)
    for (const [p, expected] of [[25, 15], [50, 20], [75, 25]] as const) {
      expect(result.quantiles[p]).toBeGreaterThanOrEqual(expected - 1)
      expect(result.quantiles[p]).toBeLessThanOrEqual(expected + 1)
    }
    expect(result.quantiles[100]).toBeLessThanOrEqual(30)
  })

  test('trials that miss the horizon sort after every finishing trial and give null quantiles', () => {
    // Each period finishes all 10 tickets with probability 2/3; with a 2-period horizon,
    // P(finish in 1) = 2/3, P(finish by 2) = 8/9, P(beyond the horizon) = 1/9.
    const result = simulateCase(
      whenCase({ trials: 10_000, maxPeriods: 2, throughputSamples: [0, 10, 10] }),
    )

    expect(result.finishedFraction).toBeCloseTo(8 / 9, 1)
    expect(result.quantiles[60]).toBe(1)
    expect(result.quantiles[80]).toBe(2)
    expect(result.quantiles.slice(92)).toEqual(Array(9).fill(null))
    expect(result.percentileDates).toEqual({ 50: '2026-01-12', 85: '2026-01-19', 95: null })
  })

  test('all-zero throughput stops at the horizon with nothing finished', () => {
    const result = simulateCase(whenCase({ throughputSamples: [0, 0] }))

    expect(result.finishedFraction).toBe(0)
    expect(result.quantiles.every((q) => q === null)).toBe(true)
    expect(result.percentileDates).toEqual({ 50: null, 85: null, 95: null })
  })
})

describe("simulateCase: 'when' for several ranked epics", () => {
  test('throughput burns down epics in rank order, carrying what is left over to the next epic', () => {
    // Rank 1 holds 1 ticket, rank 2 holds 6, at 4 per period: period 1 finishes rank 1
    // and leaves 3 for rank 2's 6; period 2 finishes rank 2.
    const result = simulateCase(
      whenCase({
        scope: [
          epic({ epicId: 'SECOND', rank: 2, baseCount: 6, currentCount: 6 }),
          epic({ epicId: 'FIRST', rank: 1, baseCount: 1, currentCount: 1 }),
        ],
        throughputSamples: [4],
      }),
    )

    expect(result.quantiles.every((q) => q === 2)).toBe(true)
    expect(result.perEpic).toHaveLength(2)
    for (const { quantiles } of result.perEpic) expect(quantiles).toHaveLength(101)
    const finish = Object.fromEntries(result.perEpic.map(({ epicId, quantiles }) => [epicId, quantiles[50]]))
    expect(finish).toEqual({ FIRST: 1, SECOND: 2 })
  })

  test('each trial draws every epic at one shared quantile, so epics over-run together', () => {
    // Two 10-ticket epics with growth [1, 3] at 10 per period. Shared: both low (20 → period 2)
    // or both high (60 → period 6), about half each. Independent draws would give 40 → period 4
    // in about half the trials, and averaging draws would pull totals to the middle too.
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [epic({ epicId: 'A', growth: [1, 3] }), epic({ epicId: 'B', rank: 2, growth: [3, 1] })],
        throughputSamples: [10],
      }),
    )

    expect(new Set(result.quantiles)).toEqual(new Set([2, 6]))
    expect(result.quantiles[40]).toBe(2)
    expect(result.quantiles[60]).toBe(6)
  })

  test('the shared draw gives a wider overall range than independent per-epic draws would', () => {
    // Ten 10-ticket epics with growth [1, 3] at 10 per period.
    // Shared: the total is 100 × (1 + 2u), so finish periods spread evenly over 10 to 30:
    // p5 to p95 is about 18 periods.
    // Independent: the total is 100 + 20 × (sum of ten uniforms), standard deviation about
    // 18 tickets or 1.8 periods: p5 to p95 would be only about 6 periods.
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: Array.from({ length: 10 }, (_, i) =>
          epic({ epicId: `EPIC-${i + 1}`, rank: i + 1, growth: { low: 1, high: 3 } }),
        ),
        throughputSamples: [10],
      }),
    )

    const spread = result.quantiles[95]! - result.quantiles[5]!
    expect(spread).toBeGreaterThanOrEqual(16)
    expect(spread).toBeLessThanOrEqual(20)
  })
})

describe('simulateCase: uncommitted epics', () => {
  test('an uncommitted epic is forecast from its provisional baseCount, like a committed one', () => {
    const scope = [
      epic({ epicId: 'A', growth: { low: 1, high: 2 } }),
      epic({ epicId: 'B', rank: 2, baseCount: 6, currentCount: 6, growth: [1, 1.5, 3] }),
    ]
    const uncommitted = scope.map((entry) => ({ ...entry, committed: false }))
    const stochastic = { trials: 2_000, throughputSamples: [0, 1, 2, 4] }

    const committedResult = simulateCase(whenCase({ ...stochastic, scope }))
    const uncommittedResult = simulateCase(whenCase({ ...stochastic, scope: uncommitted }))

    expect(uncommittedResult.quantiles).toEqual(committedResult.quantiles)
    expect(uncommittedResult.perEpic).toEqual(committedResult.perEpic)
  })

  test('the uncommitted epics are listed in the diagnostics, in rank order', () => {
    const result = simulateCase(
      whenCase({
        scope: [
          epic({ epicId: 'LATER', rank: 3, committed: false }),
          epic({ epicId: 'DONE-DEAL', rank: 1 }),
          epic({ epicId: 'SOONER', rank: 2, committed: false }),
        ],
      }),
    )

    expect(result.diagnostics.uncommittedEpicIds).toEqual(['SOONER', 'LATER'])
  })

  test('a scope of committed epics lists none', () => {
    expect(simulateCase(whenCase()).diagnostics.uncommittedEpicIds).toEqual([])
  })
})

describe('simulateCase: epics with no children', () => {
  test.each([null, 0])('an epic with baseCount %s draws its total size from the epic-size samples', (baseCount) => {
    // No children to grow from, so its total is a drawn size: 12 at 2 per period → 6 periods
    const result = simulateCase(
      whenCase({ scope: [epic({ baseCount, currentCount: 0, growth: [3] })], epicSizeSamples: [12] }),
    )

    expect(result.quantiles.every((q) => q === 6)).toBe(true)
  })

  test('each trial draws one size, with replacement, from the epic-size samples', () => {
    // Sizes 10 or 30 at 10 per period: period 1 or 3, about half each
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [epic({ baseCount: null, currentCount: 0 })],
        epicSizeSamples: [10, 30],
        throughputSamples: [10],
      }),
    )

    expect(new Set(result.quantiles)).toEqual(new Set([1, 3]))
    expect(result.quantiles[40]).toBe(1)
    expect(result.quantiles[60]).toBe(3)
  })

  test('an epic-size range draws a whole number of tickets uniformly from low to high, both ends included', () => {
    // At 1 per period the finish period is the size: 4, 5, 6 or 7, a quarter each
    const result = simulateCase(
      whenCase({
        trials: 100_000,
        scope: [epic({ baseCount: null, currentCount: 0 })],
        epicSizeSamples: { low: 4, high: 7 },
        throughputSamples: [1],
      }),
    )

    expect(result.quantiles[0]).toBe(4)
    expect(result.quantiles[24]).toBe(4)
    expect(result.quantiles[26]).toBe(5)
    expect(result.quantiles[49]).toBe(5)
    expect(result.quantiles[51]).toBe(6)
    expect(result.quantiles[74]).toBe(6)
    expect(result.quantiles[76]).toBe(7)
    expect(result.quantiles[100]).toBe(7)
  })

  test("a drawn size is never below the epic's current count", () => {
    // baseCount 0 but 14 children have since been added: 14 at 2 per period → 7 periods
    const result = simulateCase(
      whenCase({ scope: [epic({ baseCount: 0, currentCount: 14 })], epicSizeSamples: [4] }),
    )

    expect(result.quantiles.every((q) => q === 7)).toBe(true)
  })

  test("a drawn size is independent of the trial's shared growth quantile", () => {
    // A grows to 10 or 30 on the shared draw; B's size is 10 or 30 on its own draw. At 10 per
    // period the total of 20, 40 or 60 finishes in period 2, 4 or 6, about 1/4, 1/2, 1/4.
    // Had B followed the shared draw, period 4 would never happen.
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [
          epic({ epicId: 'A', growth: [1, 3] }),
          epic({ epicId: 'B', rank: 2, baseCount: null, currentCount: 0 }),
        ],
        epicSizeSamples: [10, 30],
        throughputSamples: [10],
      }),
    )

    expect(result.quantiles[20]).toBe(2)
    expect(result.quantiles[30]).toBe(4)
    expect(result.quantiles[70]).toBe(4)
    expect(result.quantiles[80]).toBe(6)
  })
})

describe('simulateCase: growth source', () => {
  test("each epic's growth source is reported in rank order: samples, ambiguity range or epic size", () => {
    const result = simulateCase(
      whenCase({
        scope: [
          epic({ epicId: 'EMPTY', rank: 3, baseCount: null, currentCount: 0 }),
          epic({ epicId: 'MEASURED', rank: 1, growth: [1, 1.4] }),
          epic({ epicId: 'AMBIGUOUS', rank: 2, growth: { low: 1, high: 2 } }),
          epic({ epicId: 'ZERO', rank: 4, baseCount: 0, currentCount: 0, growth: { low: 1, high: 2 } }),
        ],
      }),
    )

    expect(result.diagnostics.growthSource).toEqual([
      { epicId: 'MEASURED', source: 'samples' },
      { epicId: 'AMBIGUOUS', source: 'ambiguity' },
      { epicId: 'EMPTY', source: 'epicSize' },
      { epicId: 'ZERO', source: 'epicSize' },
    ])
  })
})

describe('simulateCase: trials hitting the horizon', () => {
  test('counts the trials that hit maxPeriods without finishing', () => {
    // Each period finishes all 10 tickets with probability 1/2; with a 3-period horizon,
    // 1/8 of trials never finish: about 1,250 of 10,000
    const result = simulateCase(whenCase({ trials: 10_000, maxPeriods: 3, throughputSamples: [0, 10] }))

    expect(result.diagnostics.trialsHittingHorizon).toBeGreaterThan(1_100)
    expect(result.diagnostics.trialsHittingHorizon).toBeLessThan(1_400)
    expect(result.diagnostics.trialsHittingHorizon).toBe(Math.round((1 - result.finishedFraction) * 10_000))
  })

  test('is 0 when every trial finishes', () => {
    expect(simulateCase(whenCase()).diagnostics.trialsHittingHorizon).toBe(0)
  })

  test("is 0 for 'how many', whose trials always run to byDate", () => {
    const result = simulateCase(whenCase({ question: { kind: 'howMany', byDate: '2026-02-02' } }))

    expect(result.diagnostics.trialsHittingHorizon).toBe(0)
  })
})

describe('simulateCase: pace variation', () => {
  test('is the relative standard error of the measured samples: sd / mean / √n', () => {
    // Mean 5, sample sd √2, n 2: √2 / 5 / √2 = 0.2
    const result = simulateCase(whenCase({ throughputSamples: [4, 6] }))

    expect(result.diagnostics.paceVariation).toBeCloseTo(0.2, 12)
  })

  test('is 0 when every measured sample is 0, as no week differs', () => {
    const result = simulateCase(whenCase({ throughputSamples: [0, 0, 0], maxPeriods: 4 }))

    expect(result.diagnostics.paceVariation).toBe(0)
  })

  test('is the same for every seed, as it uses no random draws', () => {
    const samples = [3, 0, 7, 2, 5]

    const values = [1, 2, 3].map((seed) => simulateCase(whenCase({ seed, throughputSamples: samples })).diagnostics.paceVariation)

    expect(new Set(values).size).toBe(1)
  })

  test('is absent for a manual range, which holds no measured samples', () => {
    const result = simulateCase(whenCase({ throughputSamples: { low: 1, high: 3 } }))

    expect(result.diagnostics).not.toHaveProperty('paceVariation')
  })

  test('is absent for a single measured sample, which has no spread', () => {
    expect(simulateCase(whenCase()).diagnostics).not.toHaveProperty('paceVariation')
  })
})

describe('simulateCase: span', () => {
  test("for 'when', the span is the periods to the median finish and the median remaining work", () => {
    // 100 committed × growth 1.3, 1.9 or 2.5, a third each, less 10 done: 120, 180 or 240 remaining,
    // a median of 180. At 6 per period the median finish is period 30.
    const result = simulateCase(
      whenCase({
        trials: 10_000,
        scope: [epic({ baseCount: 100, currentCount: 100, doneCount: 10, growth: [1.3, 1.9, 2.5] })],
        throughputSamples: [6],
      }),
    )

    expect(result.diagnostics.span).toEqual({ periods: 30, tickets: 180 })
  })

  test("for 'when', a median finish beyond the horizon has null periods", () => {
    // No pace: no trial finishes within the 10-period horizon
    const result = simulateCase(whenCase({ maxPeriods: 10, throughputSamples: [0] }))

    expect(result.diagnostics.span).toEqual({ periods: null, tickets: 10 })
  })

  test("for 'how many', the span is the periods to byDate and the median count done", () => {
    // 2026-01-05 to 2026-08-03 is 30 weekly periods; at 6 per period the median count done is 180
    const result = simulateCase(
      whenCase({ question: { kind: 'howMany', byDate: '2026-08-03' }, throughputSamples: [6] }),
    )

    expect(result.diagnostics.span).toEqual({ periods: 30, tickets: 180 })
  })
})

describe('periodEndDate', () => {
  test('is exported, so the horizon date can be formatted the way the engine does', () => {
    // Period 2 of weekly periods from 2026-01-05 ends on 2026-01-19
    expect(periodEndDate('2026-01-05', 7, 2)).toBe('2026-01-19')
  })
})

describe('simulateCase: throughput scope', () => {
  test("pace is reported as counting only the milestone's epics", () => {
    expect(simulateCase(whenCase()).diagnostics.throughputScope).toBe('milestoneEpics')
  })
})

describe('simulateCase: manual pace range', () => {
  test('measured samples are reported as the throughput source', () => {
    expect(simulateCase(whenCase()).diagnostics.throughputSource).toBe('measured')
  })

  test('a manual range paces the forecast and is reported as the throughput source', () => {
    // 10 tickets at exactly 2 per period → 5 periods
    const result = simulateCase(whenCase({ throughputSamples: { low: 2, high: 2 } }))

    expect(result.quantiles.every((q) => q === 5)).toBe(true)
    expect(result.diagnostics.throughputSource).toBe('manual')
  })
})

describe("simulateCase: 'how many by date'", () => {
  function howManyCase(byDate: string, overrides: Partial<SimulationCase> = {}): SimulationCase {
    return whenCase({ question: { kind: 'howMany', byDate }, ...overrides })
  }

  test('runs only the whole periods before byDate and counts the items done', () => {
    // 2026-01-05 to 2026-01-31 is 26 days: 3 whole weekly periods at 3 per period → 9
    const result = simulateCase(howManyCase('2026-01-31', { throughputSamples: [3] }))

    expect(result.quantiles).toHaveLength(101)
    expect(result.quantiles.every((q) => q === 9)).toBe(true)
    expect(result.percentileCounts).toEqual({ 50: 9, 85: 9, 95: 9 })
    expect(result.percentileDates).toEqual({})
    expect(result.perEpic).toEqual([])
  })

  test('draws no scope: the epic does not cap the items done', () => {
    // The epic holds 10 tickets, but 4 periods at 5 per period count 20
    const result = simulateCase(howManyCase('2026-02-02', { throughputSamples: [5] }))

    expect(result.quantiles[50]).toBe(20)
  })

  test('each period of a manual range draws a whole number uniformly from [low, high], both ends included', () => {
    // One period per trial, so each total is a single draw: 3, 4, 5 or 6, a quarter each
    const result = simulateCase(howManyCase('2026-01-12', { trials: 100_000, throughputSamples: { low: 3, high: 6 } }))

    expect(result.quantiles[0]).toBe(3)
    expect(result.quantiles[100]).toBe(6)
    expect(result.quantiles.every((q) => Number.isInteger(q))).toBe(true)
    expect(result.quantiles[24]).toBe(3)
    expect(result.quantiles[26]).toBe(4)
    expect(result.quantiles[49]).toBe(4)
    expect(result.quantiles[51]).toBe(5)
    expect(result.quantiles[74]).toBe(5)
    expect(result.quantiles[76]).toBe(6)
  })

  test('over many periods, every manual-range draw stays within its bounds', () => {
    // 52 periods: totals can only fall between 52 × 3 and 52 × 6
    const result = simulateCase(howManyCase('2027-01-04', { trials: 10_000, throughputSamples: { low: 3, high: 6 } }))

    expect(result.quantiles[0]).toBeGreaterThanOrEqual(52 * 3)
    expect(result.quantiles[100]).toBeLessThanOrEqual(52 * 6)
  })

  test("confidence runs the other way: 'p% sure' is the (100 − p)th percentile of totals", () => {
    // One period from [0, 1, 1, 1]: 0 done in a quarter of trials, 1 in the rest
    const result = simulateCase(howManyCase('2026-01-12', { trials: 10_000, throughputSamples: [0, 1, 1, 1] }))

    expect(result.quantiles[15]).toBe(0)
    expect(result.quantiles[85]).toBe(1)
    expect(result.percentileCounts).toEqual({ 50: 1, 85: 0, 95: 0 })
  })
})

describe('simulateCase: reproducibility', () => {
  const stochasticCase = whenCase({
    scope: [epic({ growth: [1, 1.4, 2, 2.6] })],
    throughputSamples: [0, 1, 2, 3, 5],
  })

  test('the same seed and case give an identical result and caseHash', () => {
    const first = simulateCase(stochasticCase)
    const second = simulateCase(structuredClone(stochasticCase))

    expect(first.caseHash).toMatch(/^[0-9a-f]{16}$/)
    expect(second).toEqual(first)
  })

  test('the caseHash does not depend on the order of keys in the case', () => {
    const reordered = Object.fromEntries(Object.entries(stochasticCase).reverse()) as SimulationCase

    expect(simulateCase(reordered).caseHash).toBe(simulateCase(stochasticCase).caseHash)
  })

  test('seeds that differ only above 32 bits give different results', () => {
    // One ticket at a 1-in-100 chance per period: 101 trials spread widely, so two
    // different random streams cannot give the same quantiles
    const spreadCase = whenCase({
      trials: 101,
      maxPeriods: 10_000,
      scope: [epic({ baseCount: 1, currentCount: 1 })],
      throughputSamples: [...Array(99).fill(0), 1],
    })

    const low = simulateCase({ ...spreadCase, seed: 1 })
    const high = simulateCase({ ...spreadCase, seed: 2 ** 32 + 1 })

    expect(high.quantiles).not.toEqual(low.quantiles)
  })

  test('a different seed gives a different caseHash', () => {
    const reseeded = { ...stochasticCase, seed: stochasticCase.seed + 1 }

    expect(simulateCase(reseeded).caseHash).not.toBe(simulateCase(stochasticCase).caseHash)
  })
})

describe('simulateCase: input limits', () => {
  test.each<[string, Partial<SimulationCase>]>([
    ['trials', { trials: 0 }],
    ['trials', { trials: 1_000_001 }],
    ['maxPeriods', { maxPeriods: 0 }],
    ['maxPeriods', { maxPeriods: 10_001 }],
    ['throughputSamples', { throughputSamples: [] }],
    ['throughputSamples', { throughputSamples: [2, -1] }],
    ['throughputSamples', { throughputSamples: [2, 1.5] }],
    ['throughputSamples', { throughputSamples: Array(100_001).fill(1) }],
    ['throughputSamples', { throughputSamples: { low: -1, high: 2 } }],
    ['throughputSamples', { throughputSamples: { low: 1.5, high: 2 } }],
    ['throughputSamples', { throughputSamples: { low: 1, high: Number.NaN } }],
    ['throughputSamples', { throughputSamples: { low: 3, high: 2 } }],
    ['throughputSamples', { throughputSamples: { low: 0, high: 100_001 } }],
    ['byDate', { question: { kind: 'howMany', byDate: 'next week' } }],
    ['byDate', { question: { kind: 'howMany', byDate: '2026-01-04' } }],
    // 157 weekly periods, one past the 156-period horizon
    ['byDate', { question: { kind: 'howMany', byDate: '2029-01-08' } }],
    ['growth', { scope: [epic({ growth: [] })] }],
    ['growth', { scope: [epic({ growth: [Number.NaN] })] }],
    ['growth', { scope: [epic({ growth: { low: -1, high: 2 } })] }],
    ['growth', { scope: [epic({ growth: { low: 1, high: Number.POSITIVE_INFINITY } })] }],
    ['growth', { scope: [epic({ growth: { low: 3, high: 2 } })] }],
    ['baseCount', { scope: [epic({ baseCount: -1 })] }],
    ['epicSizeSamples', { epicSizeSamples: [] }],
    ['epicSizeSamples', { epicSizeSamples: [8, -1] }],
    ['epicSizeSamples', { epicSizeSamples: [8, 2.5] }],
    ['epicSizeSamples', { epicSizeSamples: { low: -1, high: 8 } }],
    ['epicSizeSamples', { epicSizeSamples: { low: 1.5, high: 8 } }],
    ['epicSizeSamples', { epicSizeSamples: { low: 9, high: 8 } }],
    ['currentCount', { scope: [epic({ currentCount: -1 })] }],
    ['scope', { scope: [] }],
    ['scope', { scope: Array.from({ length: 101 }, (_, i) => epic({ epicId: `EPIC-${i + 1}`, rank: i + 1 })) }],
    ['epicId', { scope: [epic({ epicId: 'SAME' }), epic({ epicId: 'SAME', rank: 2 })] }],
    ['rank', { scope: [epic({ rank: Number.NaN })] }],
    ['rank', { scope: [epic({ rank: Number.POSITIVE_INFINITY })] }],
    ['question', { question: { kind: 'whatIf' } as unknown as SimulationCase['question'] }],
  ])('rejects a case with invalid %s', (field, overrides) => {
    expect(() => simulateCase(whenCase(overrides))).toThrow(new RegExp(field))
  })
})
