import { periodEndDate, simulateCase } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { Pace, PaceSetting } from '../model/paceSetting.js'
import { childrenOf, type Facts } from '../model/workItem.js'
import type { Storage } from '../storage/storage.js'
import { buildCase } from './buildCase.js'
import { teamMilestone } from './milestoneDefinition.js'
import { informationNotes, thinDataMessage } from './diagnostics.js'
import type { ForecastSettings } from './settings.js'
import { teamFacts } from './workflowSettings.js'

export interface EpicRow {
  epicId: string
  /** The epic's key in the ticketing tool. */
  key: string
  /** The epic's title, or its key when it has none. */
  name: string
  /** Children now, done or not; cancelled children don't count. */
  itemsNow: number
  status: 'notCommitted'
}

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

/** What the Milestone forecast screen shows. */
export type MilestoneForecastView =
  | { kind: 'noMilestone' }
  | { kind: 'milestone'; name: string; committedDate: string; forecast: ForecastSection; epics: EpicRow[] }

export interface ViewOptions {
  /** ISO calendar date the forecast starts from. */
  today: string
  settings: ForecastSettings
}

/** Seam B: the Milestone forecast screen for the team's milestone, from what is stored and the settings. */
export function milestoneForecastView(storage: Storage, teamId: string, options: ViewOptions): MilestoneForecastView {
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return { kind: 'noMilestone' }

  const facts = teamFacts(storage, teamId)
  const byId = new Map(facts.workItems.map((item) => [item.id, item]))

  return {
    kind: 'milestone',
    name: milestone.name,
    committedDate: milestone.committedDate,
    forecast: forecastFor(milestone, facts, storage.paceSetting(teamId, milestone.id), options),
    epics: milestone.epicIds.map((epicId) => {
      const epic = byId.get(epicId)
      return {
        epicId,
        key: epic?.sourceKey ?? epicId,
        name: epic?.title ?? epic?.sourceKey ?? epicId,
        itemsNow: childrenOf(facts.workItems, epicId).length,
        status: 'notCommitted',
      }
    }),
  }
}

function forecastFor(milestone: Milestone, facts: Facts, setting: PaceSetting | undefined, options: ViewOptions): ForecastSection {
  if (!setting) return { kind: 'needsPace' }
  const { teamId: _teamId, milestoneId: _milestoneId, ...pace } = setting
  const built = buildCase(milestone, facts, pace, options.settings, options.today)
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
