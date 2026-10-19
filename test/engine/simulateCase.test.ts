import { describe, expect, test } from 'vitest'
import { simulateCase, type ScopeEntry, type SimulationCase } from '../../src/engine/index.js'

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

  test('an epic with more done than its drawn total has no remaining work', () => {
    // 10 × 0.5 = 5 total, 8 done
    const result = simulateCase(whenCase({ scope: [epic({ growth: [0.5], doneCount: 8 })] }))

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
    ['growth', { scope: [epic({ growth: [] })] }],
    ['growth', { scope: [epic({ growth: [Number.NaN] })] }],
    ['baseCount', { scope: [epic({ baseCount: -1 })] }],
    ['scope', { scope: [] }],
    ['scope', { scope: [epic(), epic({ epicId: 'EPIC-2', rank: 2 })] }],
    ['question', { question: { kind: 'howMany' } as unknown as SimulationCase['question'] }],
  ])('rejects a case with invalid %s', (field, overrides) => {
    expect(() => simulateCase(whenCase(overrides))).toThrow(new RegExp(field))
  })
})
