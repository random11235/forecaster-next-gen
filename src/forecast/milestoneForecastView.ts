import { periodEndDate, simulateCase } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { PaceSetting } from '../model/paceSetting.js'
import type { Storage } from '../storage/storage.js'
import { buildCase } from './buildCase.js'
import { teamMilestone } from './milestoneDefinition.js'
import { epicAmbiguities, milestoneEpics, type MilestoneEpic } from './milestoneEpics.js'
import { epicWarnings, informationNotes, type GrowthSource } from './diagnostics.js'
import { epicGrowth, growthBasis, teamGrowth, type TeamGrowth } from './growth.js'
import { milestonePace, weeksShortfall, type MilestonePace } from './pace.js'
import type { ForecastSettings } from './settings.js'
import { teamFacts, type TeamFacts } from './teamFacts.js'

/** The milestone's finish date at one confidence level. */
export interface ForecastDate {
  percent: number
  /** ISO calendar date, `YYYY-MM-DD`, or null: later than the horizon date. */
  date: string | null
}

/**
 * The pace a forecast used: the EM's manual range, or measured over some weeks. Either way it counts only tickets under
 * the milestone's epics, so KTLO and unparented tickets are left out.
 */
export type ForecastPace = { scope: 'milestoneEpics' } & (
  | { source: 'manual'; low: number; high: number }
  | { source: 'measured'; weeks: number }
)

/** The forecast part of the screen: a forecast, or the pace the EM must enter first, and how far measured pace has got. */
export type ForecastSection =
  | { kind: 'needsPace'; message: string }
  | {
      kind: 'forecast'
      pace: ForecastPace
      dates: ForecastDate[]
      /** The last date the forecast reaches; a null date is "later than" this. */
      horizonDate: string
      /** Information for the EM, never warnings: how far measured pace has got, and how much pace varies. */
      notes: string[]
    }

/** A milestone's epic as the Milestone forecast screen shows it: as it stands, and where its growth comes from. */
export interface ForecastEpic extends MilestoneEpic {
  growthSource: GrowthSource
  /** Where its growth comes from, in the EM's words: "Medium ambiguity: grows 1–2×". */
  growthBasis: string
}

/** What the Milestone forecast screen shows. */
export type MilestoneForecastView =
  | { kind: 'noMilestone' }
  | {
      kind: 'milestone'
      name: string
      committedDate: string
      forecast: ForecastSection
      /** Warnings about the milestone's epics, shown whether or not there is a forecast yet. */
      warnings: string[]
      epics: ForecastEpic[]
    }

export interface ViewOptions {
  /** ISO calendar date the forecast starts from. */
  today: string
  settings: ForecastSettings
}

/** Seam B: the Milestone forecast screen for the team's milestone, from what is stored and the settings. */
export function milestoneForecastView(storage: Storage, teamId: string, options: ViewOptions): MilestoneForecastView {
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return { kind: 'noMilestone' }

  const team = teamFacts(storage, teamId)
  const epics = milestoneEpics(milestone, team, epicAmbiguities(storage, teamId, milestone.id))
  const growth = teamGrowth(storage, teamId, team)

  return {
    kind: 'milestone',
    name: milestone.name,
    committedDate: milestone.committedDate,
    forecast: forecastFor(milestone, team, epics, growth, storage.paceSetting(teamId, milestone.id), options),
    warnings: epicWarnings(epics, team.workflow.commitLabel),
    epics: epics.map((epic) => {
      const { source } = epicGrowth(epic, growth, options.settings)
      return { ...epic, growthSource: source, growthBasis: growthBasis(epic, source, growth, options.settings) }
    }),
  }
}

function forecastFor(
  milestone: Milestone,
  team: TeamFacts,
  epics: readonly MilestoneEpic[],
  growth: TeamGrowth,
  setting: PaceSetting | undefined,
  options: ViewOptions,
): ForecastSection {
  const pace = milestonePace(milestone, team, setting, options.settings, options.today)
  const { applied } = pace
  if (!applied) return { kind: 'needsPace', message: measuredPaceNote(pace) }

  const simulationCase = buildCase(
    epics,
    growth,
    applied.source === 'manual' ? applied.range : applied.weekly,
    options.settings,
    options.today,
  )
  const result = simulateCase(simulationCase)
  const { startDate, periodDays, maxPeriods, percentiles } = simulationCase
  return {
    kind: 'forecast',
    pace:
      applied.source === 'manual'
        ? { scope: 'milestoneEpics', source: 'manual', ...applied.range }
        : { scope: 'milestoneEpics', source: 'measured', weeks: applied.weekly.length },
    dates: percentiles.map((percent) => ({ percent, date: result.percentileDates[percent] ?? null })),
    horizonDate: periodEndDate(startDate, periodDays, maxPeriods),
    notes: [...(applied.source === 'manual' ? [measuredPaceNote(pace)] : []), ...informationNotes(result)],
  }
}

/** How far measured pace has got, while the forecast doesn't use it: ready to switch to, paused, or the weeks it needs. */
function measuredPaceNote(pace: MilestonePace): string {
  const shortfall = weeksShortfall(pace)
  if (shortfall === undefined) return `Measured pace is ready, from ${pace.weekly.length} weeks of finished tickets. Switch to it on Inputs.`
  return pace.mode === 'measured' ? `Measured pace is paused. ${shortfall}` : shortfall
}
