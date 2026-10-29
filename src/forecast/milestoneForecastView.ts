import { periodEndDate, simulateCase, ENGINE_VERSION, type ForecastResult, type SimulationCase } from '../engine/index.js'
import type { Ambiguity, GrowthRange } from '../model/ambiguity.js'
import type { Storage } from '../storage/storage.js'
import { milestoneGrowth } from './growth.js'
import { inputProblems, inputWarnings, isForecastable, type ForecastableInputs, type InputNote } from './milestoneInputs.js'
import type { ForecastSettings } from './settings.js'

/** The confidence level the headline states. */
export const HEADLINE_PERCENT = 85

/** The milestone's finish date at one confidence level. */
export interface ForecastDate {
  percent: number
  /** ISO calendar date, `YYYY-MM-DD`, or null: later than the horizon date. */
  date: string | null
  /** The date is before today: a past start date can give a finish that has already gone by. */
  alreadyPast: boolean
}

/** One period's bar on the finish graph. Shares are fractions of all trials, from 0 to 1. */
export interface FinishBar {
  /** ISO calendar date the period ends: the start date for the first bar, which counts trials with nothing to do. */
  date: string
  /** The share of trials that finish in this period. */
  share: number
  /** The share of trials finished by the end of this period. */
  finishedBy: number
}

/** What the Milestone forecast screen shows. */
export type MilestoneForecastView =
  /** Nothing entered yet: the screen sends the EM to Inputs. */
  | { kind: 'empty' }
  /** Inputs that can't be forecast, each naming what to fix. */
  | { kind: 'problems'; name: string; problems: InputNote[] }
  | {
      kind: 'forecast'
      name: string
      ticketsRemaining: number
      /** ISO calendar date the forecast starts from. */
      startDate: string
      headlinePercent: number
      dates: ForecastDate[]
      /** The last date the forecast reaches; a null date is "later than" this. */
      horizonDate: string
      /** Days in one of the team's periods, which the pace is per. */
      cadenceDays: number
      pace: { source: 'range'; low: number; high: number }
      /** The milestone's ambiguity level and the growth range it used. */
      ambiguity: { level: Ambiguity } & GrowthRange
      warnings: InputNote[]
      /** When the trials finish: one bar per period, from the start date to the last finish within the horizon. */
      finishGraph: FinishBar[]
    }

/** Seam B: the Milestone forecast screen for the team's milestone, forecast from its start date, on `today`. */
export function milestoneForecastView(storage: Storage, teamId: string, settings: ForecastSettings, today: string): MilestoneForecastView {
  const inputs = storage.milestoneInputs(teamId)
  if (!inputs) return { kind: 'empty' }
  if (!isForecastable(inputs)) return { kind: 'problems', name: inputs.name, problems: inputProblems(inputs) }

  const growth = milestoneGrowth(storage, inputs)
  const simulationCase = milestoneCase(inputs, growth, settings)
  const result = simulateCase(simulationCase)
  const { periodDays, maxPeriods, percentiles } = simulationCase
  return {
    kind: 'forecast',
    name: inputs.name,
    ticketsRemaining: inputs.ticketsRemaining,
    startDate: inputs.startDate,
    headlinePercent: HEADLINE_PERCENT,
    dates: percentiles.map((percent) => forecastDate(percent, result.percentileDates[percent] ?? null, today)),
    horizonDate: periodEndDate(inputs.startDate, periodDays, maxPeriods),
    cadenceDays: inputs.cadenceDays,
    pace: { source: 'range', ...inputs.paceRange },
    ambiguity: { level: inputs.ambiguity, ...growth },
    warnings: inputWarnings(inputs, today),
    finishGraph: finishGraph(result, simulationCase),
  }
}

function forecastDate(percent: number, date: string | null, today: string): ForecastDate {
  // ISO calendar dates order as strings do
  return { percent, date, alreadyPast: date !== null && date < today }
}

/**
 * The milestone as one scope entry of the tickets remaining, none done, growing by its ambiguity's range, in periods of
 * its cadence. With 0 tickets the engine would draw a size, so the size range is pinned to 0 and the forecast finishes
 * on the start date.
 */
function milestoneCase(inputs: ForecastableInputs, growth: GrowthRange, settings: ForecastSettings): SimulationCase {
  const { startDate, ticketsRemaining, paceRange } = inputs
  return {
    engineVersion: ENGINE_VERSION,
    seed: settings.seed,
    trials: settings.trials,
    maxPeriods: settings.maxPeriods,
    question: { kind: 'when' },
    startDate,
    periodDays: inputs.cadenceDays,
    scope: [
      {
        // The engine names each scope entry by its epic; the milestone is the team's only one
        epicId: inputs.teamId,
        rank: 1,
        baseCount: ticketsRemaining,
        currentCount: ticketsRemaining,
        doneCount: 0,
        growth,
      },
    ],
    throughputSamples: paceRange,
    epicSizeSamples: { low: 0, high: 0 },
    percentiles: settings.percentiles,
  }
}

/**
 * The finish graph from the result's 101 quantiles. Quantile p is the period by which p% of trials have finished, so
 * the share finished by a period is the highest p whose quantile is no later than it, to the nearest whole percent
 * below. The last bar takes the exact finished fraction, so the shares sum to it.
 */
function finishGraph(result: ForecastResult, { startDate, periodDays }: SimulationCase): FinishBar[] {
  // Quantiles rise with p, and those beyond the horizon (null) come last
  const finishPeriods = result.quantiles.filter((period) => period !== null)
  const lastPeriod = finishPeriods.at(-1)
  if (lastPeriod === undefined) return []
  const bars: FinishBar[] = []
  let finishedBefore = 0
  for (let period = 0; period <= lastPeriod; period++) {
    const percentBy = Math.max(finishPeriods.filter((finish) => finish <= period).length - 1, 0)
    const finishedBy = period === lastPeriod ? result.finishedFraction : percentBy / 100
    bars.push({ date: periodEndDate(startDate, periodDays, period), share: withoutFloatError(finishedBy - finishedBefore), finishedBy })
    finishedBefore = finishedBy
  }
  return bars
}

/** Rounds to 9 decimal places, so a share of 0.07 − 0.05 reads 0.02. */
function withoutFloatError(value: number): number {
  return Math.round(value * 1e9) / 1e9
}
