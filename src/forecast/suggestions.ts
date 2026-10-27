import type { GrowthRange } from '../engine/index.js'
import type { ForecastSettings } from './settings.js'

/** A measured range offered to the EM, and what it was measured from. It applies only once the EM adopts it. */
export interface Suggestion extends GrowthRange {
  basis: string
}

/**
 * The measured growth suggested for medium ambiguity: the span of the team's growth samples, once there are at least
 * `minGrowthSamples`, rounded out to the half like the ranges the EM types: a few epics' extremes are too noisy to
 * show finer. Adopted, medium epics draw from the samples themselves, not this span.
 */
export function measuredMediumSuggestion(growthSamples: readonly number[], settings: ForecastSettings): Suggestion | undefined {
  if (!hasEnoughGrowthSamples(growthSamples, settings)) return undefined
  return {
    low: Math.floor(Math.min(...growthSamples) * 2 + ROUNDING_SLACK) / 2,
    high: Math.ceil(Math.max(...growthSamples) * 2 - ROUNDING_SLACK) / 2,
    basis: `Measured from ${growthSamples.length} finished committed epics`,
  }
}

/** Whether there are enough growth samples to suggest, or draw from, measured growth. */
export function hasEnoughGrowthSamples(growthSamples: readonly number[], settings: ForecastSettings): boolean {
  return growthSamples.length >= settings.minGrowthSamples
}

/** Keeps a ratio that is a half in all but floating-point error, such as 2.9999999999, from rounding to the next half. */
const ROUNDING_SLACK = 1e-9
