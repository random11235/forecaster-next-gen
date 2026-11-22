import { simulateCase, ENGINE_VERSION, type GrowthRange, type SimulationCase, type ThroughputRange } from '../../engine/index.js'
import { finishGraph } from './milestoneForecastView.js'
import { DEFAULT_AMBIGUITY_RANGES, type ForecastSettings } from './settings.js'

/** The example the How it works screen explains with: a milestone of medium ambiguity at a manual pace range. */
const EXAMPLE = {
  ticketsRemaining: 30,
  growth: DEFAULT_AMBIGUITY_RANGES.medium,
  pace: { low: 4, high: 8 },
  cadenceDays: 7,
}

/** Any fixed date: the screen counts in weeks from the start, never in dates. */
const START_DATE = '2026-01-05'

/** The finishes the screen draws as single simulations: these percentiles, in an order that doesn't look sorted. */
const SOME_FINISHES = [30, 75, 50, 15, 90, 60]

/** The week by which a share of the simulations finish, `percent` of them. */
interface FinishWeek {
  percent: number
  period: number
}

/** What the How it works screen shows: the example, forecast by the engine as a milestone would be. */
export interface HowItWorksView {
  example: { ticketsRemaining: number; growth: GrowthRange; pace: ThroughputRange; cadenceDays: number }
  /** The share of simulations finishing in each week, from week 0 (the start) to the 99% week. */
  finishes: { period: number; share: number }[]
  /** The burndown's answer: the tickets remaining at the middle of the pace range, and the share of simulations done by then. */
  averagePace: { perPeriod: number; period: number; met: number }
  /** The 50% and 85% weeks. */
  weeks: [FinishWeek, FinishWeek]
  /** Six finish weeks to draw as single simulations. */
  someFinishes: number[]
}

/** Seam B: the How it works screen, its pictures drawn from the engine so they can't drift from what a forecast does. */
export function howItWorksView(settings: ForecastSettings): HowItWorksView {
  const simulationCase = exampleCase(settings)
  const result = simulateCase(simulationCase)
  const { bars } = finishGraph(result, simulationCase)
  const perPeriod = (EXAMPLE.pace.low + EXAMPLE.pace.high) / 2
  const period = Math.ceil(EXAMPLE.ticketsRemaining / perPeriod)
  const finishPeriod = (percent: number): number => result.quantiles[percent]!
  const finishWeek = (percent: number): FinishWeek => ({ percent, period: finishPeriod(percent) })
  return {
    example: EXAMPLE,
    finishes: bars.map(({ share }, at) => ({ period: at, share })),
    averagePace: { perPeriod, period, met: bars[period]?.finishedBy ?? 0 },
    weeks: [finishWeek(50), finishWeek(85)],
    someFinishes: SOME_FINISHES.map(finishPeriod),
  }
}

function exampleCase(settings: ForecastSettings): SimulationCase {
  const { ticketsRemaining, growth, pace, cadenceDays } = EXAMPLE
  return {
    engineVersion: ENGINE_VERSION,
    seed: settings.seed,
    trials: settings.trials,
    maxPeriods: settings.maxPeriods,
    question: { kind: 'when' },
    startDate: START_DATE,
    periodDays: cadenceDays,
    scope: [{ epicId: 'example', rank: 1, baseCount: ticketsRemaining, currentCount: ticketsRemaining, doneCount: 0, growth }],
    throughputSamples: pace,
    epicSizeSamples: { low: 0, high: 0 },
    percentiles: settings.percentiles,
  }
}
