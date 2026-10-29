import { periodEndDate, simulateCase, ENGINE_VERSION, type SimulationCase } from '../engine/index.js'
import type { GrowthRange } from '../model/ambiguity.js'
import type { Storage } from '../storage/storage.js'
import { inputProblems, inputWarnings, isForecastable, type ForecastableInputs, type InputNote } from './milestoneInputs.js'
import { DEFAULT_AMBIGUITY_RANGES, type ForecastSettings } from './settings.js'

/** The confidence level the headline states. */
export const HEADLINE_PERCENT = 85

/** The milestone's finish date at one confidence level. */
export interface ForecastDate {
  percent: number
  /** ISO calendar date, `YYYY-MM-DD`, or null: later than the horizon date. */
  date: string | null
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
      pace: { source: 'range'; low: number; high: number }
      warnings: InputNote[]
    }

export interface ViewOptions {
  /** ISO calendar date the screen is shown on. */
  today: string
  settings: ForecastSettings
}

/** Seam B: the Milestone forecast screen for the team's milestone, forecast from its start date. */
export function milestoneForecastView(storage: Storage, teamId: string, options: ViewOptions): MilestoneForecastView {
  const inputs = storage.milestoneInputs(teamId)
  if (!inputs) return { kind: 'empty' }
  if (!isForecastable(inputs)) return { kind: 'problems', name: inputs.name, problems: inputProblems(inputs) }

  const growth = (storage.ambiguityRanges(teamId) ?? DEFAULT_AMBIGUITY_RANGES).medium
  const simulationCase = milestoneCase(inputs, growth, options.settings)
  const result = simulateCase(simulationCase)
  const { periodDays, maxPeriods, percentiles } = simulationCase
  return {
    kind: 'forecast',
    name: inputs.name,
    ticketsRemaining: inputs.ticketsRemaining,
    startDate: inputs.startDate,
    headlinePercent: HEADLINE_PERCENT,
    dates: percentiles.map((percent) => ({ percent, date: result.percentileDates[percent] ?? null })),
    horizonDate: periodEndDate(inputs.startDate, periodDays, maxPeriods),
    pace: { source: 'range', ...inputs.paceRange },
    warnings: inputWarnings(inputs),
  }
}

/**
 * The milestone as one scope entry of the tickets remaining, none done, growing by the medium range. With 0 tickets
 * the engine would draw a size, so the size range is pinned to 0 and the forecast finishes on the start date.
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
    periodDays: settings.periodDays,
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
