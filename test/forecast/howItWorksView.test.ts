import { beforeAll, describe, expect, test } from 'vitest'
import type { HowItWorksView } from '../../src/forecast/index.js'
import { forecastingForTest } from './forecastingForTest.js'

// The How it works screen's example: 30 tickets remaining, medium ambiguity (1–2×), 4–8 a week. Grown, the work is 30
// to 60 tickets, so a simulation finishes no sooner than week 4 (30 at 8 a week) and no later than week 15 (60 at 4).

describe('How it works: the example forecast', () => {
  let view: HowItWorksView
  beforeAll(async () => {
    view = await (await forecastingForTest()).howItWorksView()
  })

  test('is the example the screen describes', () => {
    expect(view.example).toEqual({ ticketsRemaining: 30, growth: { low: 1, high: 2 }, pace: { low: 4, high: 8 }, cadenceDays: 7 })
  })

  test('its simulations finish between week 4 and week 15, one share per week from the start to the week 99% of them have finished by', () => {
    const finishing = view.finishes.filter(({ share }) => share > 0).map(({ period }) => period)
    const finishedBy = (shares: { share: number }[]) => shares.reduce((sum, { share }) => sum + share, 0)

    expect(Math.min(...finishing)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...finishing)).toBeLessThanOrEqual(15)
    expect(view.finishes.map(({ period }) => period)).toEqual(view.finishes.map((_, at) => at))
    expect(finishedBy(view.finishes)).toBeGreaterThanOrEqual(0.99)
    expect(finishedBy(view.finishes.slice(0, -1))).toBeLessThan(0.99)
  })

  test('the burndown at the average pace, 6 a week, reaches the 30 tickets in week 5, which far fewer than half the simulations meet', () => {
    expect(view.averagePace).toMatchObject({ perPeriod: 6, period: 5 })
    expect(view.averagePace.met).toBeGreaterThan(0)
    expect(view.averagePace.met).toBeLessThan(0.25)
  })

  test('reads the 50% and the later 85% week from the simulations', () => {
    const [half, sure] = view.weeks
    expect(half.percent).toBe(50)
    expect(sure.percent).toBe(85)
    expect(half.period).toBeGreaterThan(view.averagePace.period)
    expect(sure.period).toBeGreaterThan(half.period)
  })

  test('shows six simulations finishing in different weeks within the spread', () => {
    expect(view.someFinishes).toHaveLength(6)
    expect(new Set(view.someFinishes).size).toBeGreaterThan(2)
    for (const period of view.someFinishes) expect(period).toBeGreaterThanOrEqual(4)
  })
})
