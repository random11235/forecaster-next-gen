import type { GrowthRange } from '../../engine/index.js'
import { AMBIGUITIES, type Ambiguity, type AmbiguityRanges } from '../../model/ambiguity.js'
import type { MilestoneInputs } from '../../model/milestoneInputs.js'
import type { Storage } from '../../storage/storage.js'
import { refuse, type EditResult } from './editResult.js'
import { DEFAULT_AMBIGUITY_RANGES } from './settings.js'

/** Each level's growth range as typed on the Inputs screen: numbers of times the tickets remaining, low ≤ high. */
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
  /** Each level as a label: "Medium". */
  names: Readonly<Record<Ambiguity, string>>
}

/** The level as a label: "Medium". */
export function ambiguityName(level: Ambiguity): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

// Object.fromEntries can't know its keys are each level once, so the cast says so
const AMBIGUITY_NAMES: Readonly<Record<Ambiguity, string>> = Object.fromEntries(AMBIGUITIES.map((level) => [level, ambiguityName(level)])) as Record<
  Ambiguity,
  string
>

/** Seam B, behind `inputsView`: the team's ambiguity ranges as the Inputs screen shows them. */
export function growthView(storage: Storage, teamId: string): GrowthView {
  const { low, medium, high } = savedRanges(storage, teamId)
  return { ranges: { low, medium, high }, names: AMBIGUITY_NAMES }
}

/** The team's ambiguity ranges as the EM saved them, or the defaults until they do. */
export function savedRanges(storage: Storage, teamId: string): Omit<AmbiguityRanges, 'teamId'> {
  return storage.ambiguityRanges(teamId) ?? DEFAULT_AMBIGUITY_RANGES
}

/**
 * The milestone's growth: the team's range for its ambiguity level. The only place ambiguity becomes growth, so
 * per-epic or measured growth can replace it here; the engine keeps the grown total at or above the tickets remaining.
 */
export function milestoneGrowth(storage: Storage, inputs: MilestoneInputs): GrowthRange {
  return savedRanges(storage, inputs.teamId)[inputs.ambiguity]
}

/**
 * Seam B, through `submitInputs`: saves the EM's ambiguity ranges. A refused edit changes nothing and says why, naming
 * the first level whose range is refused.
 */
export function editGrowth(storage: Storage, teamId: string, typed: GrowthEdit): EditResult {
  const ranges: Partial<Record<Ambiguity, GrowthRange>> = {}
  for (const level of AMBIGUITIES) {
    const refuseLevel = (why: string) => refuse(`${ambiguityName(level)} ambiguity: ${why}`)
    const [low, high] = [typed[level].low.trim(), typed[level].high.trim()]
    if (!isNumber(low) || !isNumber(high)) return refuseLevel('enter the range as two numbers, such as 1 to 1.5.')
    const range = { low: Number(low), high: Number(high) }
    if (range.low <= 0 || range.high <= 0 || range.high > MAX_GROWTH) {
      return refuseLevel(`enter growth above 0 and at most ${MAX_GROWTH} times.`)
    }
    if (range.low > range.high) return refuseLevel('the low end must not be above the high end.')
    ranges[level] = range
  }
  storage.saveAmbiguityRanges({ teamId, ...(ranges as Record<Ambiguity, GrowthRange>) })
  return { ok: true }
}

/** A plain decimal, signed or not: `1`, `1.5`, `.5` or `-1`; a negative one is refused as not above 0. */
function isNumber(value: string): boolean {
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(value)
}
