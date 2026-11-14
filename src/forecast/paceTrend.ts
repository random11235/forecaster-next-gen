import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { PaceFrom } from './paceReads.js'
import { paceSource, paceWindow, type DatedCounts } from './paceWindow.js'
import type { ForecastSettings } from './settings.js'
import type { Measured } from './trackerReads.js'

/**
 * The counts in use, typed or the tracker's, drawn as bars, oldest first, with a straight least-squares line fitted through them. Information
 * only: the EM reads its slope; it adds no note and leaves the forecast unchanged.
 */
export interface PaceTrend {
  /** Tickets done in each past period, oldest first: one bar each. */
  counts: number[]
  /** The fitted line's value at the oldest count. */
  start: number
  /** The fitted line's value at the newest count. */
  end: number
  /**
   * Following the tracker with a comparable-work query, both reads' finished tickets in each period counted, paired;
   * none otherwise, where the graph shows the counts alone.
   */
  paired: PairedPace | undefined
}

/** Comparable work's finished tickets and the milestone's own, period by period, each at the same place as `counts`. */
export interface PairedPace {
  /** Whose finished tickets the pace, and so `counts`, comes from: the series the graph marks. */
  from: PaceFrom
  comparableWork: number[]
  milestone: number[]
  /** How many of the periods, the first ones, come before the milestone's start date, when its own pace didn't count. */
  beforeStart: number
}

/**
 * The trend of the counts in use, typed or the tracker's (`measured`), those in the pace window on `today`, when they
 * are the pace and there are as many as a forecast needs; otherwise none, as with the range or too few counts.
 */
export function paceTrend(inputs: MilestoneInputs, { typedCounts }: ForecastSettings, today: string, measured?: Measured): PaceTrend | undefined {
  const source = paceSource(inputs, measured)
  const { window } = paceWindow(inputs, today, measured)
  const counts = window.counts
  if (source === 'range' || counts.length < typedCounts.forForecast) return undefined
  return { counts, ...fittedLine(counts), paired: source === 'tracker' ? paired(window, inputs.startDate, measured) : undefined }
}

/** Both reads' counts in each period of `window`, found by the period's start; none without a complete read of each. */
function paired(window: DatedCounts, startDate: string | undefined, measured: Measured | undefined): PairedPace | undefined {
  const reading = measured?.pace
  if (!reading?.comparableWork || !reading.milestone || startDate === undefined) return undefined
  const at = ({ counts, starts }: DatedCounts): number[] => window.starts.map((start) => counts[starts.indexOf(start)] ?? 0)
  // ISO calendar dates order as strings do
  const beforeStart = window.starts.filter((start) => start < startDate).length
  return { from: reading.from, comparableWork: at(reading.comparableWork), milestone: at(reading.milestone), beforeStart }
}

/** The least-squares line through the counts at periods 0, 1, … n−1: its values at the first and the last. */
function fittedLine(counts: readonly number[]): { start: number; end: number } {
  const n = counts.length
  const meanPeriod = (n - 1) / 2
  const meanCount = counts.reduce((sum, count) => sum + count, 0) / n
  let covariance = 0
  let variance = 0
  counts.forEach((count, period) => {
    covariance += (period - meanPeriod) * (count - meanCount)
    variance += (period - meanPeriod) ** 2
  })
  // a single count has no slope: the line is flat through it
  const slope = variance === 0 ? 0 : covariance / variance
  return { start: meanCount - slope * meanPeriod, end: meanCount + slope * meanPeriod }
}
