import type { ForecastResult } from '../engine/index.js'

/**
 * Pace variation (relative standard error) bands. Split-halves' 25% and 75% bands correspond to about 15% and 44%
 * RSE (split-halves ≈ 1.70 × RSE): see
 * https://github.com/random11235/forecaster-next-gen/blob/main/docs/research/pace-stability/README.md#split-halves-error-is-the-relative-standard-error
 */
const STEADY_BELOW = 0.15
const VARIES_A_LOT_FROM = 0.44

/**
 * Information notes for the EM, from the engine's diagnostics. These are never warnings: lumpy weeks give a wide
 * range that still holds up.
 */
export function informationNotes(result: ForecastResult): string[] {
  const { paceVariation } = result.diagnostics
  return paceVariation === undefined ? [] : [paceVariationNote(paceVariation)]
}

function paceVariationNote(relativeStandardError: number): string {
  if (relativeStandardError < STEADY_BELOW) return 'Your weekly pace is steady, so the range is narrow.'
  if (relativeStandardError < VARIES_A_LOT_FROM) return 'Your weekly pace varies, so the range is wider.'
  return 'Your weekly pace varies a lot, so the range is wide.'
}
