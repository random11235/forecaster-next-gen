import type { GrowthRange } from '../engine/index.js'
import { AMBIGUITIES, type Ambiguity, type AmbiguityRanges } from '../model/ambiguity.js'
import type { MilestoneInputs } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { refuse, type EditResult } from './editResult.js'
import { DEFAULT_AMBIGUITY_RANGES } from './settings.js'

/** Each level's growth range as typed on the Inputs screen: numbers of times the baseline, low ≤ high. */
export type GrowthEdit = { kind: 'setAmbiguityRanges' } & Record<Ambiguity, TypedRange>

/** A range as the EM typed it. */
export interface TypedRange {
  low: string
  high: string
}

/** Far above any real growth; keeps typos like 150 out of the forecast. */
export const MAX_GROWTH = 10

/** What the Inputs screen shows of growth. */
export interface GrowthView {
  ranges: Record<Ambiguity, GrowthRange>
}

/** The level as a label: "Medium". */
export function ambiguityName(level: Ambiguity): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

/** Seam B, behind `inputsView`: the team's ambiguity ranges as the Inputs screen shows them. */
export function growthView(storage: Storage, teamId: string): GrowthView {
  const { low, medium, high } = savedRanges(storage, teamId)
  return { ranges: { low, medium, high } }
}

/** The team's ambiguity ranges as the EM saved them, or the defaults until they do. */
export function savedRanges(storage: Storage, teamId: string): Omit<AmbiguityRanges, 'teamId'> {
  return storage.ambiguityRanges(teamId) ?? DEFAULT_AMBIGUITY_RANGES
}

/**
 * The milestone's growth: the team's range for its ambiguity level. The only place ambiguity becomes growth, so
 * per-epic growth or split rates can replace it here; the engine keeps the grown total at or above the tickets remaining.
 */
export function milestoneGrowth(storage: Storage, inputs: MilestoneInputs): GrowthRange {
  return savedRanges(storage, inputs.teamId)[inputs.ambiguity]
}

/** Seam B, through `editInputs`: saves the EM's ambiguity ranges. A refused edit changes nothing and says why. */
export function editGrowth(storage: Storage, teamId: string, typed: GrowthEdit): EditResult {
  const ranges: Partial<Record<Ambiguity, GrowthRange>> = {}
  for (const level of AMBIGUITIES) {
    const [low, high] = [typed[level].low.trim(), typed[level].high.trim()]
    if (!isNumber(low) || !isNumber(high)) return refuse('Enter each range as two numbers, such as 1 to 1.5.')
    const range = { low: Number(low), high: Number(high) }
    if (range.low <= 0 || range.high > MAX_GROWTH) return refuse(`Enter growth above 0 and at most ${MAX_GROWTH} times.`)
    if (range.low > range.high) return refuse('The low end must not be above the high end.')
    ranges[level] = range
  }
  storage.saveAmbiguityRanges({ teamId, ...(ranges as Record<Ambiguity, GrowthRange>) })
  return { ok: true }
}

/** A plain decimal: `1`, `1.5` or `.5`. */
function isNumber(value: string): boolean {
  return /^(\d+(\.\d*)?|\.\d+)$/.test(value)
}
