import { periodEndDate, simulateCase, ENGINE_VERSION, type ForecastResult, type SimulationCase } from '../../engine/index.js'
import type { Ambiguity, GrowthRange } from '../../model/ambiguity.js'
import type { CapacityEntry } from '../../model/capacity.js'
import {
  capacityFactors,
  capacityLine,
  capacityView,
  currentEntries,
  entryEffect,
  shiftOf,
  type CapacityUse,
  type CapacityView,
  type ComparedDate,
  type Shift,
  type PacePeriods,
} from './capacity.js'
import { periodName, type PeriodName } from './cadence.js'
import { counted } from './counted.js'
import { logForecast } from './forecastLedger.js'
import { milestoneGrowth } from './growth.js'
import { assessMilestone, type ForecastableInputs, type ForecastPace, type InputNote } from './milestoneAssessment.js'
import { paceActionApplied, pacePattern, type PacePatternView } from './pacePattern.js'
import type { PaceInUse } from './pace.js'
import { paceTrend, type PaceTrend } from './paceTrend.js'
import type { ForecastSettings } from './settings.js'
import type { TeamContext } from './teamContext.js'
import { measureSaved, milestonePace } from './trackerReads.js'

export type { CapacityView, ComparedDate } from './capacity.js'

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

/** One period's bar on the finish graph. Shares are fractions of all trials, from 0 to 1. */
export interface FinishBar {
  /** Which period it is, counting the start date's as 0. */
  period: number
  /** ISO calendar date the period ends: the start date for the first bar, which counts trials with nothing to do. */
  date: string
  /** The share of trials that finish in this period. */
  share: number
  /** The share of trials finished by the end of this period. */
  finishedBy: number
  /** The team's capacity in this period, in % of its usual: 100 for a usual period, and for the first bar, which ends on the start date. */
  capacity: number
}

/**
 * When the last trial finishes: by the end of a period, its ISO calendar date and its number from the start (0), or
 * beyond the horizon, when some trials don't finish within it.
 */
export type LastFinish = { kind: 'by'; date: string; period: number } | { kind: 'beyondHorizon' }

/** The trials finishing after the finish graph's last bar, summed under it. */
export interface LaterFinishes {
  /** Their share of all trials, from 0 to 1. */
  share: number
  last: LastFinish
}

/**
 * When the trials finish: one bar per period, from the start date to the 99% date, or the latest confidence date if
 * later, and never past the last finish within the horizon; and the trials finishing after the last bar, summed.
 */
export interface FinishGraph {
  bars: FinishBar[]
  /** None when every trial finishes by the last bar, or none finishes at all. */
  later: LaterFinishes | undefined
}

/** What the Milestone forecast screen shows. */
export type MilestoneForecastView =
  /** Nothing entered yet: the screen sends the EM to Inputs. */
  | { kind: 'empty' }
  /**
   * Inputs that can't be forecast, each naming what to fix: one missing, or too few typed counts. With a pace action
   * applied, it is said with undo, since it may be what left too few.
   */
  | ({ kind: 'problems'; name: string; problems: InputNote[]; paceApplied?: string } & PaceActionRefused)
  | ({
      kind: 'forecast'
      name: string
      ticketsRemaining: number
      /** The tickets remaining in words: "40 tickets". */
      ticketsRemainingSaid: string
      /** ISO calendar date the forecast starts from. */
      startDate: string
      headlinePercent: number
      dates: ForecastDate[]
      /** The last date the forecast reaches; a null date is "later than" this. */
      horizonDate: string
      /** Days in one of the team's periods, which the pace is per. */
      cadenceDays: number
      /** What the screens call one of those periods: a week or a sprint. */
      period: PeriodName
      /** The pace the dates come from. */
      pace: ForecastPace
      /** The pace the dates come from, as the forecast says it: "4–8 tickets per week (range)", "typed counts, 6 sprints", or "GitHub’s last 8 weeks, 2 skipped". */
      paceSaid: string
      /** The milestone's ambiguity level and the growth range it used. */
      ambiguity: { level: Ambiguity } & GrowthRange
      warnings: InputNote[]
      finishGraph: FinishGraph
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
    } & PaceActionRefused)

/** A pace action the EM just submitted, refused: why, shown under the pace pattern, or alone with none to show. */
interface PaceActionRefused {
  paceActionRefusal?: string
}

/** Whether the Milestone forecast screen opens with its Capacity section open, where each entry gives its own effect. */
export interface CapacityShown {
  capacityOpen?: boolean
}

/**
 * Seam B: the Milestone forecast screen for the team's milestone, forecast from its start date, on `today`. Each
 * entry's effect takes a run of its own, so it is worked out only with the Capacity section open. The forecast shown is
 * logged in the team's ledger, which storage keeps (#27).
 */
export function milestoneForecastView(team: TeamContext, { capacityOpen = false }: CapacityShown = {}): MilestoneForecastView {
  const { storage, teamId, settings, tracker } = team
  const { today } = team.at
  const saved = storage.milestoneInputs(teamId)
  if (!saved) return { kind: 'empty' }
  const measured = measureSaved(tracker, teamId)
  const milestone = milestonePace(saved, settings, today, measured)
  const { inUse } = milestone
  const assessment = assessMilestone(saved, today, milestone, measured)
  if (!assessment.forecastable) {
    const applied = paceActionApplied(saved, inUse)
    return { kind: 'problems', name: saved.name, problems: assessment.problems, ...(applied && { paceApplied: applied }) }
  }

  const { inputs, pace } = assessment
  const growth = milestoneGrowth(storage, inputs)
  // with no entries the forecast uses (none past), or none touching the forecast's periods, the case is the MVP's, hash and all
  const entries = currentEntries(storage.capacityEntries(teamId), today)
  const factorsOf = (some: readonly CapacityEntry[]) => capacityFactors(some, inputs.startDate, inputs.cadenceDays, settings.maxPeriods)
  const factors = factorsOf(entries)
  const on = storage.capacityOn(teamId)
  const simulationCase = milestoneCase(inputs, pace, growth, settings, on ? factors : undefined)
  const result = simulateCase(simulationCase)
  // the forecast shown, logged; the runs it is compared with below are not shown, so not logged
  logForecast(storage, { teamId, milestoneName: inputs.name, simulationCase, result })
  const { periodDays, maxPeriods, percentiles } = simulationCase
  // at usual capacity from the same seed, so the two differ by capacity alone
  const atUsual = on && factors ? simulateCase(milestoneCase(inputs, pace, growth, settings, undefined)) : undefined
  const comparison = atUsual && COMPARED_PERCENTS.map((percent) => comparedDate(percent, result, atUsual, periodDays))
  // the headline is one of the compared levels, so its shift is the comparison's
  const headline = comparison?.find(({ percent }) => percent === HEADLINE_PERCENT)
  const use: CapacityUse = !factors ? { kind: 'unused' } : on && headline ? { kind: 'inUse', shift: headline.shift } : { kind: 'off' }
  const period = periodName(periodDays)
  // each entry against a run without it, from the same seed, so the two differ by that entry alone
  const effects =
    capacityOpen && on && entries.length > 0
      ? new Map<number, Shift>(
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
    ticketsRemainingSaid: counted(inputs.ticketsRemaining, 'ticket'),
    startDate: inputs.startDate,
    headlinePercent: HEADLINE_PERCENT,
    dates: percentiles.map((percent) => forecastDate(percent, result.percentileDates[percent] ?? null, today)),
    horizonDate: periodEndDate(inputs.startDate, periodDays, maxPeriods),
    cadenceDays: inputs.cadenceDays,
    period,
    pace,
    paceSaid: paceSaid(pace, period),
    ambiguity: { level: inputs.ambiguity, ...growth },
    warnings: assessment.warnings.map(({ input, message }) => ({ input, message })),
    finishGraph: finishGraph(result, simulationCase),
    paceTrend: paceTrend(inUse, settings, inputs.startDate),
    pacePattern:
      inUse.source !== 'range'
        ? pacePattern(inUse, inputs.paceWindow.action, periodDays, {
            percent: HEADLINE_PERCENT,
            now: result.percentileDates[HEADLINE_PERCENT] ?? null,
            // from the same seed and capacity, so the two differ by the action alone
            from: (counts) =>
              simulateCase(milestoneCase(inputs, { source: 'counts', counts: [...counts] }, growth, settings, on ? factors : undefined)).percentileDates[
                HEADLINE_PERCENT
              ] ?? null,
          })
        : undefined,
    capacity: capacityView(storage, teamId, today, use, period, { open: capacityOpen, ...(effects && { effects }), pace: pacePeriods(inUse) }),
    comparison,
    capacityLine: capacityLine(use),
  }
}

/** A date with capacity and at usual capacity, and how far capacity moves it, in periods and in words. */
function comparedDate(percent: number, withCapacity: ForecastResult, atUsual: ForecastResult, periodDays: number): ComparedDate {
  const dated = withCapacity.percentileDates[percent] ?? null
  const usual = atUsual.percentileDates[percent] ?? null
  return { percent, withCapacity: dated, atUsual: usual, shift: shiftOf(dated, usual, periodDays) }
}

/** The pace the dates come from, said in the milestone's `period`. */
function paceSaid(pace: ForecastPace, period: PeriodName): string {
  if (pace.source === 'tracker')
    // ending at finished comparable work's last ticket, its periods aren't the last
    return `${pace.tracker}’s ${pace.lastFinished === undefined ? 'last ' : ''}${pace.counts.length === 1 && pace.lastFinished === undefined ? period : counted(pace.counts.length, period)}${pace.skipped > 0 ? `, ${pace.skipped} skipped` : ''}`
  return pace.source === 'counts' ? `typed counts, ${counted(pace.counts.length, period)}` : `${pace.low}–${pace.high} tickets per ${period} (range)`
}

/** The periods the pace comes from, for the new-usual rule: each in the pace window, dated back from today's period. */
function pacePeriods(pace: PaceInUse): PacePeriods {
  return pace.source === 'range' ? { source: 'range' } : { source: pace.source, starts: pace.window.starts }
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
  pace: ForecastPace,
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
    throughputSamples: pace.source !== 'range' ? pace.counts : { low: pace.low, high: pace.high },
    epicSizeSamples: { low: 0, high: 0 },
    percentiles: settings.percentiles,
    ...(factors && { capacity: factors }),
  }
}

/** The confidence level the finish graph ends at, unless a confidence level the forecast gives is later. */
const GRAPHED_PERCENT = 99

/**
 * The finish graph: for each period from the start to its last period (`lastGraphedPeriod`), the share of trials
 * finishing in it and by it, and its capacity. A trial finishing in bar `n` finished during the engine's period `n - 1`,
 * so that is the capacity it carries. The trials finishing after the last bar are summed, with when the last of them
 * finishes; with no bars, there is no sum.
 */
export function finishGraph(result: ForecastResult, { startDate, periodDays, trials, percentiles, capacity = [] }: SimulationCase): FinishGraph {
  let finishedBefore = 0
  const bars = result.finishCounts.slice(0, lastGraphedPeriod(result, percentiles) + 1).map((count, period) => {
    finishedBefore += count
    const factor = period === 0 ? 1 : (capacity[period - 1] ?? 1)
    return { period, date: periodEndDate(startDate, periodDays, period), share: count / trials, finishedBy: finishedBefore / trials, capacity: factor * 100 }
  })
  const unshown = trials - finishedBefore
  if (bars.length === 0 || unshown === 0) return { bars, later: undefined }
  const lastPeriod = result.finishCounts.length - 1
  const last: LastFinish =
    result.finishedFraction < 1 ? { kind: 'beyondHorizon' } : { kind: 'by', date: periodEndDate(startDate, periodDays, lastPeriod), period: lastPeriod }
  return { bars, later: { share: unshown / trials, last } }
}

/**
 * The finish graph's last period: the 99% period, or the latest confidence level's if later, so every marker stays on
 * the graph. A confidence level beyond the horizon has no period, so then the graph runs to the last finish. It is never
 * before period 1, so a graph with later finishes keeps a bar to draw beside the start date's.
 */
function lastGraphedPeriod(result: ForecastResult, percentiles: readonly number[]): number {
  const periods = [GRAPHED_PERCENT, ...percentiles].map((percent) => result.quantiles[percent] ?? Infinity)
  return Math.max(1, ...periods)
}
