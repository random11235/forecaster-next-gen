import type { MilestoneInputs } from '../model/milestoneInputs.js'
import { paceWindow } from './paceWindow.js'
import type { ForecastSettings } from './settings.js'

/**
 * The typed counts drawn as bars, oldest first, with a straight least-squares line fitted through them. Information
 * only: the EM reads its slope; it adds no note and leaves the forecast unchanged.
 */
export interface PaceTrend {
  /** Tickets done in each past period, oldest first: one bar each. */
  counts: number[]
  /** The fitted line's value at the oldest count. */
  start: number
  /** The fitted line's value at the newest count. */
  end: number
}

/**
 * The trend of the typed counts in use, those in the pace window on `today`, when they are the pace and there are as
 * many as a forecast needs; otherwise none, as with the range or too few counts.
 */
export function paceTrend(inputs: MilestoneInputs, { typedCounts }: ForecastSettings, today: string): PaceTrend | undefined {
  const counts = paceWindow(inputs, today).window.counts
  if (inputs.paceMode !== 'counts' || counts.length < typedCounts.forForecast) return undefined
  return { counts, ...fittedLine(counts) }
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
