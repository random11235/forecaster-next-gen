import { periodEndDate, simulateCase, ENGINE_VERSION, type SimulationCase } from '../engine/index.js'
import type { GrowthRange } from '../model/ambiguity.js'
import type { Storage } from '../storage/storage.js'
import { savedRanges } from './growth.js'
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
      warnings: InputNote[]
    }

/** Seam B: the Milestone forecast screen for the team's milestone, forecast from its start date, on `today`. */
export function milestoneForecastView(storage: Storage, teamId: string, settings: ForecastSettings, today: string): MilestoneForecastView {
  const inputs = storage.milestoneInputs(teamId)
  if (!inputs) return { kind: 'empty' }
  if (!isForecastable(inputs)) return { kind: 'problems', name: inputs.name, problems: inputProblems(inputs) }

  const growth = savedRanges(storage, teamId).medium
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
    warnings: inputWarnings(inputs, today),
  }
}

function forecastDate(percent: number, date: string | null, today: string): ForecastDate {
  // ISO calendar dates order as strings do
  return { percent, date, alreadyPast: date !== null && date < today }
}

/**
 * The milestone as one scope entry of the tickets remaining, none done, growing by the medium range, in periods of
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
