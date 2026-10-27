import type { EpicSizeRange, GrowthRange } from '../engine/index.js'
import { AMBIGUITIES, type Ambiguity, type AmbiguityRanges } from '../model/ambiguity.js'
import { epicSizeSamples } from '../samples/epicSize.js'
import { finishedEpics } from '../samples/finishedEpics.js'
import { growthSamples } from '../samples/growth.js'
import type { Storage } from '../storage/storage.js'
import type { GrowthSource } from './diagnostics.js'
import { refuse, type EditResult } from './editResult.js'
import { teamMilestone } from './milestoneDefinition.js'
import { baselineOf, type MilestoneEpic } from './milestoneEpics.js'
import { DEFAULT_AMBIGUITY_RANGES, type ForecastSettings } from './settings.js'
import { hasEnoughGrowthSamples, measuredMediumSuggestion, type Suggestion } from './suggestions.js'
import type { TeamFacts } from './teamFacts.js'

/** A change the EM makes to how the milestone's epics grow, on the Inputs screen. */
export type GrowthEdit =
  /** The epic's ambiguity level as chosen: low, medium or high. */
  | { kind: 'setEpicAmbiguity'; epicId: string; ambiguity: string }
  /** Each level's growth range as typed: numbers of times the baseline, low ≤ high. */
  | ({ kind: 'setAmbiguityRanges' } & Record<Ambiguity, TypedRange>)
  /** Adopts the measured growth for medium: medium epics draw from the team's growth samples. */
  | { kind: 'useMeasuredMedium' }
  /** Goes back to the medium range. */
  | { kind: 'useMediumRange' }

/** A range as the EM typed it. */
export interface TypedRange {
  low: string
  high: string
}

/** Far above any real epic's growth; keeps typos like 150 out of the forecast. */
export const MAX_GROWTH = 10

/** What the Inputs screen shows of growth. */
export interface GrowthView {
  ranges: Record<Ambiguity, GrowthRange>
  /** The EM adopted the measured growth for medium. */
  mediumMeasured: boolean
  /** Adopted measured growth is paused: too few finished committed epics are left, so medium grows by its range. */
  paused: boolean
  /** Finished committed epics with a baseline: the team's growth samples. */
  finishedEpics: number
  /** How many measured growth needs (`minGrowthSamples`): below it, adopted measured growth is paused. */
  needed: number
  /** The measured medium range, once enough finished committed epics exist. */
  suggestion: Suggestion | undefined
}

/** What the forecast draws each epic's growth from: the team's ambiguity ranges, and what its finished epics measured. */
export interface TeamGrowth {
  /** As the EM edited them, or the defaults. */
  ranges: Omit<AmbiguityRanges, 'teamId'>
  /** Growth ratios of the team's finished committed epics, pooled. */
  growthSamples: number[]
  /** Final sizes of the team's finished committed epics. */
  epicSizeSamples: number[]
}

/** The team's ambiguity ranges, and the growth and sizes measured from its finished committed epics. */
export function teamGrowth(storage: Storage, teamId: string, team: TeamFacts): TeamGrowth {
  const { teamId: _teamId, ...ranges } = savedRanges(storage, teamId)
  const finished = finishedEpics(team.commits.values(), team.facts, team.workflow)
  return {
    ranges,
    growthSamples: growthSamples(finished).map((sample) => sample.ratio),
    epicSizeSamples: epicSizeSamples(finished).map((sample) => sample.finalCount),
  }
}

/**
 * What the epic's growth is drawn from, and where that comes from: the team's growth samples for a medium epic once
 * the EM adopted them (while enough exist), or else its ambiguity level's range. An epic with no baseline children
 * draws a whole-epic size instead (`epicSizes`).
 */
export function epicGrowth(
  epic: MilestoneEpic,
  growth: TeamGrowth,
  settings: ForecastSettings,
): { growth: number[] | GrowthRange; source: GrowthSource } {
  const measured =
    epic.ambiguity === 'medium' && growth.ranges.mediumMeasured && hasEnoughGrowthSamples(growth.growthSamples, settings)
  const drawn = measured ? growth.growthSamples : growth.ranges[epic.ambiguity]
  if (baselineOf(epic) === 0) return { growth: drawn, source: 'epicSize' }
  return { growth: drawn, source: measured ? 'samples' : 'ambiguity' }
}

/**
 * Where the epic's growth comes from, as the Milestone forecast screen says it: "Medium ambiguity: grows 1–2×",
 * "Medium ambiguity: grows as measured from 7 finished epics" or "No items yet: sized from 3 finished epics".
 */
export function growthBasis(epic: MilestoneEpic, source: GrowthSource, growth: TeamGrowth, settings: ForecastSettings): string {
  const level = `${ambiguityName(epic.ambiguity)} ambiguity`
  switch (source) {
    case 'ambiguity': {
      const grows = `${level}: grows ${rangeText(growth.ranges[epic.ambiguity])}`
      return epic.ambiguity === 'medium' && measuredPaused(growth, settings)
        ? `${grows} (measured growth paused: ${growth.growthSamples.length} of ${settings.minGrowthSamples} finished epics)`
        : grows
    }
    case 'samples':
      return `${level}: grows as measured from ${finishedEpicsText(growth.growthSamples.length)}`
    case 'epicSize': {
      const sizes = epicSizes(growth, settings)
      return Array.isArray(sizes)
        ? `No items yet: sized from ${finishedEpicsText(sizes.length)}`
        : `No items yet: sized ${sizes.low}–${sizes.high} items`
    }
  }
}

/** The level as a label: "Medium". */
export function ambiguityName(level: Ambiguity): string {
  return level.charAt(0).toUpperCase() + level.slice(1)
}

/** A growth range as the EM reads it: "1–1.5×", or "1.5×" when its ends meet. */
export function rangeText({ low, high }: GrowthRange): string {
  return low === high ? `${low}×` : `${low}–${high}×`
}

/** The EM adopted measured growth for medium, but too few finished committed epics are left to draw from. */
function measuredPaused(growth: TeamGrowth, settings: ForecastSettings): boolean {
  return growth.ranges.mediumMeasured && !hasEnoughGrowthSamples(growth.growthSamples, settings)
}

function finishedEpicsText(count: number): string {
  return count === 1 ? '1 finished epic' : `${count} finished epics`
}

/** The sizes an epic with no children draws from: finished committed epics' final sizes, or the default range until any exist. */
export function epicSizes(growth: TeamGrowth, settings: ForecastSettings): number[] | EpicSizeRange {
  return growth.epicSizeSamples.length > 0 ? growth.epicSizeSamples : settings.defaultEpicSize
}

/** Seam B, behind `inputsView`: the team's growth as the Inputs screen shows it. */
export function growthView(storage: Storage, teamId: string, team: TeamFacts, settings: ForecastSettings): GrowthView {
  const growth = teamGrowth(storage, teamId, team)
  const { ranges, growthSamples } = growth
  const { low, medium, high, mediumMeasured } = ranges
  return {
    ranges: { low, medium, high },
    mediumMeasured,
    paused: measuredPaused(growth, settings),
    finishedEpics: growthSamples.length,
    needed: settings.minGrowthSamples,
    suggestion: measuredMediumSuggestion(growthSamples, settings),
  }
}

/** Applies the EM's growth edit and saves it. A refused edit changes nothing. */
export function editGrowth(
  storage: Storage,
  teamId: string,
  team: TeamFacts,
  edit: GrowthEdit,
  settings: ForecastSettings,
): EditResult {
  switch (edit.kind) {
    case 'setAmbiguityRanges':
      return setAmbiguityRanges(storage, teamId, edit)
    case 'useMeasuredMedium': {
      const { ranges, growthSamples } = teamGrowth(storage, teamId, team)
      if (!hasEnoughGrowthSamples(growthSamples, settings)) {
        const needed = settings.minGrowthSamples
        return refuse(`Measured growth needs ${needed} finished committed epics; there are ${growthSamples.length} so far.`)
      }
      storage.saveAmbiguityRanges({ teamId, ...ranges, mediumMeasured: true })
      return { ok: true }
    }
    case 'useMediumRange':
      storage.saveAmbiguityRanges({ ...savedRanges(storage, teamId), mediumMeasured: false })
      return { ok: true }
    case 'setEpicAmbiguity':
      return setEpicAmbiguity(storage, teamId, edit)
  }
}

function setEpicAmbiguity(storage: Storage, teamId: string, edit: { epicId: string; ambiguity: string }): EditResult {
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return refuse('Define the milestone first.')
  if (!isAmbiguity(edit.ambiguity)) return refuse('Choose low, medium or high ambiguity.')
  if (!milestone.epicIds.includes(edit.epicId)) return refuse('That epic is not in the milestone.')
  storage.saveEpicAmbiguity({ teamId, milestoneId: milestone.id, epicId: edit.epicId, ambiguity: edit.ambiguity })
  return { ok: true }
}

function isAmbiguity(value: string): value is Ambiguity {
  return (AMBIGUITIES as readonly string[]).includes(value)
}

function setAmbiguityRanges(storage: Storage, teamId: string, typed: Record<Ambiguity, TypedRange>): EditResult {
  const ranges: Partial<Record<Ambiguity, GrowthRange>> = {}
  for (const level of AMBIGUITIES) {
    const [low, high] = [typed[level].low.trim(), typed[level].high.trim()]
    if (!isNumber(low) || !isNumber(high)) return refuse('Enter each range as two numbers, such as 1 to 1.5.')
    const range = { low: Number(low), high: Number(high) }
    if (range.low <= 0 || range.high > MAX_GROWTH) return refuse(`Enter growth above 0 and at most ${MAX_GROWTH} times.`)
    if (range.low > range.high) return refuse('The low end must not be above the high end.')
    ranges[level] = range
  }
  const { mediumMeasured } = savedRanges(storage, teamId)
  storage.saveAmbiguityRanges({ teamId, ...(ranges as Record<Ambiguity, GrowthRange>), mediumMeasured })
  return { ok: true }
}

/** A plain decimal: `1`, `1.5` or `.5`. */
function isNumber(value: string): boolean {
  return /^(\d+(\.\d*)?|\.\d+)$/.test(value)
}

/** The team's saved ambiguity ranges, or the defaults until the EM saves some. */
function savedRanges(storage: Storage, teamId: string): AmbiguityRanges {
  return storage.ambiguityRanges(teamId) ?? { teamId, ...DEFAULT_AMBIGUITY_RANGES }
}
