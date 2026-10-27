import { periodEndDate, simulateCase } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { Pace, PaceSetting } from '../model/paceSetting.js'
import type { Storage } from '../storage/storage.js'
import { buildCase } from './buildCase.js'
import { teamMilestone } from './milestoneDefinition.js'
import { epicAmbiguities, milestoneEpics, type MilestoneEpic } from './milestoneEpics.js'
import { epicWarnings, informationNotes, thinDataMessage, type GrowthSource } from './diagnostics.js'
import { epicGrowth, growthBasis, teamGrowth, type TeamGrowth } from './growth.js'
import type { ForecastSettings } from './settings.js'
import { teamFacts, type TeamFacts } from './teamFacts.js'

/** The milestone's finish date at one confidence level. */
export interface ForecastDate {
  percent: number
  /** ISO calendar date, `YYYY-MM-DD`, or null: later than the horizon date. */
  date: string | null
}

/** The forecast part of the screen: a forecast, what the EM must enter first, or why the data can't forecast yet. */
export type ForecastSection =
  | { kind: 'needsPace' }
  | { kind: 'thinData'; message: string }
  | {
      kind: 'forecast'
      pace: Pace
      dates: ForecastDate[]
      /** The last date the forecast reaches; a null date is "later than" this. */
      horizonDate: string
      /** Information for the EM, never warnings. */
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
  if (!setting) return { kind: 'needsPace' }
  const { teamId: _teamId, milestoneId: _milestoneId, ...pace } = setting
  const built = buildCase(milestone, team, epics, growth, pace, options.settings, options.today)
  if (!built.ok) return { kind: 'thinData', message: thinDataMessage(built.reason) }

  const result = simulateCase(built.simulationCase)
  const { startDate, periodDays, maxPeriods, percentiles } = built.simulationCase
  return {
    kind: 'forecast',
    pace,
    dates: percentiles.map((percent) => ({ percent, date: result.percentileDates[percent] ?? null })),
    horizonDate: periodEndDate(startDate, periodDays, maxPeriods),
    notes: informationNotes(result),
  }
}
