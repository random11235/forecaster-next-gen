import { periodEndDate, simulateCase, ENGINE_VERSION, type ForecastResult, type SimulationCase } from '../engine/index.js'
import type { Ambiguity, GrowthRange } from '../model/ambiguity.js'
import type { Storage } from '../storage/storage.js'
import { daysBetween } from './calendarDate.js'
import { capacityFactors, capacityLine, capacityView, type CapacityUse, type CapacityView } from './capacity.js'
import { periodName } from './cadence.js'
import { milestoneGrowth } from './growth.js'
import { assessMilestone, type ForecastableInputs, type InputNote, type PaceInUse } from './milestoneAssessment.js'
import { paceTrend, type PaceTrend } from './paceTrend.js'
import type { ForecastSettings } from './settings.js'

/** The confidence level the headline states. */
export const HEADLINE_PERCENT = 85

/** The confidence levels the comparison of capacity with usual capacity gives. */
export const COMPARED_PERCENTS: readonly number[] = [50, HEADLINE_PERCENT, 95]

/** The milestone's finish date at one confidence level. */
export interface ForecastDate {
  percent: number
  /** ISO calendar date, `YYYY-MM-DD`, or null: later than the horizon date. */
  date: string | null
  /** The date is before today: a past start date can give a finish that has already gone by. */
  alreadyPast: boolean
}

/** One confidence level with capacity and at usual capacity, from the same draws. */
export interface ComparedDate {
  percent: number
  /** ISO calendar dates, or null: later than the horizon date. */
  withCapacity: string | null
  atUsual: string | null
  /** How many periods later (negative: sooner) capacity moves the date; null when either is later than the horizon. */
  shift: number | null
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
  /** Inputs that can't be forecast, each naming what to fix: one missing, or too few typed counts. */
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
      /** The pace the dates come from. */
      pace: PaceInUse
      /** The milestone's ambiguity level and the growth range it used. */
      ambiguity: { level: Ambiguity } & GrowthRange
      warnings: InputNote[]
      /** When the trials finish: one bar per period, from the start date to the last finish within the horizon. */
      finishGraph: FinishBar[]
      /** The typed counts in use and their fitted line, shown as warnings are; none with the range. */
      paceTrend: PaceTrend | undefined
      /** The team's capacity, beside the pace; each period's pace is scaled by it. */
      capacity: CapacityView
      /** With capacity in use, each date with capacity (as `dates` gives it) and at usual capacity; none otherwise. */
      comparison: ComparedDate[] | undefined
      /** The quiet line under the headline: what capacity does to its date; none when no capacity touches it. */
      capacityLine: string | undefined
    }

/** Seam B: the Milestone forecast screen for the team's milestone, forecast from its start date, on `today`. */
export function milestoneForecastView(storage: Storage, teamId: string, settings: ForecastSettings, today: string): MilestoneForecastView {
  const saved = storage.milestoneInputs(teamId)
  if (!saved) return { kind: 'empty' }
  const assessment = assessMilestone(saved, settings, today)
  if (!assessment.forecastable) return { kind: 'problems', name: saved.name, problems: assessment.problems }

  const { inputs, pace } = assessment
  const growth = milestoneGrowth(storage, inputs)
  // with no entries, or none touching the forecast's periods, the case is the MVP's, hash and all
  const factors = capacityFactors(storage.capacityEntries(teamId), inputs.startDate, inputs.cadenceDays, settings.maxPeriods)
  const on = storage.capacityOn(teamId)
  const simulationCase = milestoneCase(inputs, pace, growth, settings, on ? factors : undefined)
  const result = simulateCase(simulationCase)
  const { periodDays, maxPeriods, percentiles } = simulationCase
  // at usual capacity from the same seed, so the two differ by capacity alone
  const atUsual = on && factors ? simulateCase(milestoneCase(inputs, pace, growth, settings, undefined)) : undefined
  const comparison = atUsual && COMPARED_PERCENTS.map((percent) => comparedDate(percent, result, atUsual, periodDays))
  const headlineShift = comparison?.find(({ percent }) => percent === HEADLINE_PERCENT)?.shift ?? null
  const use: CapacityUse = !factors ? { kind: 'unused' } : on ? { kind: 'inUse', shift: headlineShift } : { kind: 'off' }
  const period = periodName(periodDays)
  return {
    kind: 'forecast',
    name: inputs.name,
    ticketsRemaining: inputs.ticketsRemaining,
    startDate: inputs.startDate,
    headlinePercent: HEADLINE_PERCENT,
    dates: percentiles.map((percent) => forecastDate(percent, result.percentileDates[percent] ?? null, today)),
    horizonDate: periodEndDate(inputs.startDate, periodDays, maxPeriods),
    cadenceDays: inputs.cadenceDays,
    pace,
    ambiguity: { level: inputs.ambiguity, ...growth },
    warnings: assessment.warnings.map(({ input, message }) => ({ input, message })),
    finishGraph: finishGraph(result, simulationCase),
    paceTrend: paceTrend(inputs, settings),
    capacity: capacityView(storage, teamId, use, period),
    comparison,
    capacityLine: capacityLine(use, period),
  }
}

function comparedDate(percent: number, withCapacity: ForecastResult, atUsual: ForecastResult, periodDays: number): ComparedDate {
  const dated = withCapacity.percentileDates[percent] ?? null
  const usual = atUsual.percentileDates[percent] ?? null
  const shift = dated === null || usual === null ? null : daysBetween(usual, dated) / periodDays
  return { percent, withCapacity: dated, atUsual: usual, shift }
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
function milestoneCase(
  inputs: ForecastableInputs,
  pace: PaceInUse,
  growth: GrowthRange,
  settings: ForecastSettings,
  factors: number[] | undefined,
): SimulationCase {
  const { startDate, ticketsRemaining } = inputs
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
    // typed counts are drawn by the Bayesian bootstrap (ADR-0001), a range uniformly
    throughputSamples: pace.source === 'counts' ? pace.counts : { low: pace.low, high: pace.high },
    epicSizeSamples: { low: 0, high: 0 },
    percentiles: settings.percentiles,
    ...(factors && { capacity: factors }),
  }
}

/** The finish graph: for each period from the start to the last finish, the share of trials finishing in it and by it. */
export function finishGraph(result: ForecastResult, { startDate, periodDays, trials }: SimulationCase): FinishBar[] {
  let finishedBefore = 0
  return result.finishCounts.map((count, period) => {
    finishedBefore += count
    return { date: periodEndDate(startDate, periodDays, period), share: count / trials, finishedBy: finishedBefore / trials }
  })
}
