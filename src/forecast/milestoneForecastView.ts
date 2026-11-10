import { periodEndDate, simulateCase, ENGINE_VERSION, type ForecastResult, type SimulationCase } from '../engine/index.js'
import type { Ambiguity, GrowthRange } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import type { Storage } from '../storage/storage.js'
import { daysBetween } from './calendarDate.js'
import { capacityFactors, capacityLine, capacityView, currentEntries, entryEffect, type CapacityUse, type CapacityView, type EntryEffect, type PacePeriods } from './capacity.js'
import { periodName } from './cadence.js'
import { milestoneGrowth } from './growth.js'
import { assessMilestone, type ForecastableInputs, type InputNote, type PaceInUse } from './milestoneAssessment.js'
import { pacePattern, type PacePatternView } from './pacePattern.js'
import { paceWindow } from './paceWindow.js'
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
  /** The team's capacity in this period, in % of its usual: 100 for a usual period, and for the first bar, which ends on the start date. */
  capacity: number
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
      /** The shape of the typed counts in use, under the pace bars; none with the range. */
      pacePattern: PacePatternView | undefined
      /** The team's capacity, beside the pace; each period's pace is scaled by it. */
      capacity: CapacityView
      /** With capacity in use, each date with capacity (as `dates` gives it) and at usual capacity; none otherwise. */
      comparison: ComparedDate[] | undefined
      /** The quiet line under the headline: what capacity does to its date; none when no capacity touches it. */
      capacityLine: string | undefined
    }

/** How the screen is shown: `capacityOpen` with the Capacity section open, where each entry gives its own effect. */
export interface ForecastViewOptions {
  capacityOpen?: boolean
}

/**
 * Seam B: the Milestone forecast screen for the team's milestone, forecast from its start date, on `today`. Each
 * entry's effect takes a run of its own, so it is worked out only with the Capacity section open.
 */
export function milestoneForecastView(
  storage: Storage,
  teamId: string,
  settings: ForecastSettings,
  today: string,
  { capacityOpen = false }: ForecastViewOptions = {},
): MilestoneForecastView {
  const saved = storage.milestoneInputs(teamId)
  if (!saved) return { kind: 'empty' }
  const assessment = assessMilestone(saved, settings, today)
  if (!assessment.forecastable) return { kind: 'problems', name: saved.name, problems: assessment.problems }

  const { inputs, pace } = assessment
  const growth = milestoneGrowth(storage, inputs)
  // with no entries the forecast uses (none past), or none touching the forecast's periods, the case is the MVP's, hash and all
  const entries = currentEntries(storage.capacityEntries(teamId), today)
  const factorsOf = (some: readonly CapacityEntry[]) => capacityFactors(some, inputs.startDate, inputs.cadenceDays, settings.maxPeriods)
  const factors = factorsOf(entries)
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
  // each entry against a run without it, from the same seed, so the two differ by that entry alone
  const effects =
    capacityOpen && on && entries.length > 0
      ? new Map<number, EntryEffect>(
          entries.map((entry) => {
            const without = simulateCase(milestoneCase(inputs, pace, growth, settings, factorsOf(entries.filter((other) => other !== entry))))
            return [entry.id, entryEffect(comparedDate(HEADLINE_PERCENT, result, without, periodDays), period)]
          }),
        )
      : undefined
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
    paceTrend: paceTrend(inputs, settings, today),
    pacePattern:
      pace.source === 'counts'
        ? pacePattern(paceWindow(inputs, today), inputs.paceWindow.action, periodDays, {
            percent: HEADLINE_PERCENT,
            fewestCounts: settings.typedCounts.forForecast,
            now: result.percentileDates[HEADLINE_PERCENT] ?? null,
            // from the same seed and capacity, so the two differ by the action alone
            from: (counts) =>
              simulateCase(milestoneCase(inputs, { source: 'counts', counts: [...counts] }, growth, settings, on ? factors : undefined))
                .percentileDates[HEADLINE_PERCENT] ?? null,
          })
        : undefined,
    capacity: capacityView(storage, teamId, today, use, period, { open: capacityOpen, ...(effects && { effects }), pace: pacePeriods(inputs, pace, today) }),
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

/** The periods the pace comes from, for the new-usual rule: each in the pace window, dated back from today's period. */
function pacePeriods(inputs: ForecastableInputs, pace: PaceInUse, today: string): PacePeriods {
  return pace.source === 'range' ? { source: 'range' } : { source: 'counts', starts: paceWindow(inputs, today).window.starts }
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

/**
 * The finish graph: for each period from the start to the last finish, the share of trials finishing in it and by it, and
 * its capacity. A trial finishing in bar `n` finished during the engine's period `n - 1`, so that is the capacity it carries.
 */
export function finishGraph(result: ForecastResult, { startDate, periodDays, trials, capacity = [] }: SimulationCase): FinishBar[] {
  let finishedBefore = 0
  return result.finishCounts.map((count, period) => {
    finishedBefore += count
    const factor = period === 0 ? 1 : (capacity[period - 1] ?? 1)
    return { date: periodEndDate(startDate, periodDays, period), share: count / trials, finishedBy: finishedBefore / trials, capacity: factor * 100 }
  })
}
