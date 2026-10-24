import { periodEndDate, simulateCase, type SimulationCase } from '../engine/index.js'
import type { PaceSetting } from '../model/paceSetting.js'
import type { Storage } from '../storage/storage.js'
import { buildCase, childrenOf } from './buildCase.js'
import { informationNotes } from './diagnostics.js'
import { DEFAULT_SETTINGS } from './settings.js'

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

/** The forecast part of the screen: a forecast, or what the EM must enter first. */
export type ForecastSection =
  | { kind: 'needsPace' }
  | {
      kind: 'forecast'
      pace: { mode: 'manual'; low: number; high: number } | { mode: 'measured' }
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
}

/** Seam B: the Milestone forecast screen for the team's milestone, from what is stored. */
export function milestoneForecastView(storage: Storage, teamId: string, options: ViewOptions): MilestoneForecastView {
  const milestone = storage.milestones(teamId)[0]
  if (!milestone) return { kind: 'noMilestone' }

  const facts = storage.facts(teamId)
  const byId = new Map(facts.workItems.map((item) => [item.id, item]))
  const pace = storage.paceSetting(teamId, milestone.id)

  return {
    kind: 'milestone',
    name: milestone.name,
    committedDate: milestone.committedDate,
    forecast: forecastSection(pace && buildCase(milestone, facts, pace, DEFAULT_SETTINGS, options.today), pace),
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

function forecastSection(simulationCase: SimulationCase | undefined, pace: PaceSetting | undefined): ForecastSection {
  if (!simulationCase || !pace) return { kind: 'needsPace' }
  const result = simulateCase(simulationCase)
  const { startDate, periodDays, maxPeriods, percentiles } = simulationCase
  return {
    kind: 'forecast',
    pace: pace.mode === 'manual' ? { mode: 'manual', low: pace.low, high: pace.high } : { mode: 'measured' },
    dates: percentiles.map((percent) => ({ percent, date: result.percentileDates[percent] ?? null })),
    horizonDate: periodEndDate(startDate, periodDays, maxPeriods),
    notes: informationNotes(result),
  }
}
