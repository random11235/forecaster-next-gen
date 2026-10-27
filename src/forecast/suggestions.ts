import type { GrowthRange } from '../engine/index.js'
import type { ForecastSettings } from './settings.js'

/** A measured range offered to the EM, and what it was measured from. It applies only once the EM adopts it. */
export interface Suggestion extends GrowthRange {
  basis: string
}

/**
 * The measured growth suggested for medium ambiguity: the span of the team's growth samples, once there are at least
 * `minGrowthSamples`. Adopted, medium epics draw from the samples themselves.
 */
export function measuredMediumSuggestion(growthSamples: readonly number[], settings: ForecastSettings): Suggestion | undefined {
  if (!hasEnoughGrowthSamples(growthSamples, settings)) return undefined
  return {
    low: roundRatio(Math.min(...growthSamples)),
    high: roundRatio(Math.max(...growthSamples)),
    basis: `Measured from ${growthSamples.length} finished committed epics`,
  }
}

/** Whether there are enough growth samples to suggest, or draw from, measured growth. */
export function hasEnoughGrowthSamples(growthSamples: readonly number[], settings: ForecastSettings): boolean {
  return growthSamples.length >= settings.minGrowthSamples
}

function roundRatio(ratio: number): number {
  return Math.round(ratio * 100) / 100
}
