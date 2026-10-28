import type { ThroughputRange } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { PaceMode, PaceSetting } from '../model/paceSetting.js'
import { dailyThroughput, type ThroughputSample } from '../samples/throughput.js'
import type { Storage } from '../storage/storage.js'
import { counted } from './counted.js'
import { refuse, type EditResult } from './editResult.js'
import { teamMilestone } from './milestoneDefinition.js'
import type { ForecastSettings } from './settings.js'
import { teamFacts, type TeamFacts } from './teamFacts.js'

const MS_PER_DAY = 86_400_000

/** Measured pace in brief: the fewest and most tickets finished in a week, over how many weeks. */
export interface MeasuredPace {
  weeks: number
  low: number
  high: number
}

/** The milestone's pace: what the EM chose, what the measured window holds, and which pace the forecast uses. */
export interface MilestonePace {
  mode: PaceMode
  manual: ThroughputRange | undefined
  /** Tickets finished under the milestone's epics per week since installation, oldest first, from the first week with one. */
  weekly: number[]
  weeksNeeded: number
  /** The pace the forecast uses, or undefined when the EM must enter a manual range first. */
  applied: { source: 'manual'; range: ThroughputRange } | { source: 'measured'; weekly: number[] } | undefined
}

/** The Inputs screen's pace section. */
export interface PaceView {
  manual: ThroughputRange | undefined
  /** The pace the EM chose. Measured pace applies only once the milestone has `weeksNeeded` weeks. */
  mode: PaceMode
  /** The EM chose measured pace, but the milestone has too few weeks for it, so the manual range is used. */
  paused: boolean
  /** Weeks of the milestone's finished tickets since installation, from the first week with one. */
  weeks: number
  weeksNeeded: number
  /** Measured pace, once there are enough weeks for it. */
  measured: MeasuredPace | undefined
  /** Why measured pace isn't offered yet: "Only 4 weeks of finished tickets. Measured pace needs 8." */
  message: string | undefined
}

/** A change to the milestone's pace source. */
export type PaceEdit =
  /** Uses measured pace in place of the manual range, which is kept. */
  | { kind: 'useMeasuredPace' }
  /** Goes back to the manual range. */
  | { kind: 'useManualPace' }

/**
 * The milestone's pace on `today`. Only tickets under the milestone's epics count, and only in whole weeks that start
 * at or after installation, so nothing from before it is used. Measured pace applies once the EM has chosen it and
 * the milestone has `minMeasuredPaceWeeks` weeks; until then the manual range does.
 */
export function milestonePace(
  milestone: Milestone,
  team: TeamFacts,
  setting: PaceSetting | undefined,
  settings: ForecastSettings,
  today: string,
): MilestonePace {
  const daily = dailyThroughput(team.facts.workItems, milestone.epicIds, team.installedAt, today)
  const weekly = fromFirstFinished(periodCounts(daily, settings.periodDays, today))
  const mode = setting?.mode ?? 'manual'
  const manual = setting?.manual
  const measuredReady = weekly.length >= settings.minMeasuredPaceWeeks
  const applied =
    mode === 'measured' && measuredReady
      ? { source: 'measured' as const, weekly }
      : manual && { source: 'manual' as const, range: manual }
  return { mode, manual, weekly, weeksNeeded: settings.minMeasuredPaceWeeks, applied }
}

/** Why measured pace isn't ready, or undefined once it is. */
export function weeksShortfall({ weekly, weeksNeeded }: MilestonePace): string | undefined {
  const weeks = weekly.length
  if (weeks >= weeksNeeded) return undefined
  if (weeks === 0) return `No finished tickets yet. Measured pace needs ${counted(weeksNeeded, 'week')} of them.`
  return `Only ${counted(weeks, 'week')} of finished tickets. Measured pace needs ${weeksNeeded}.`
}

export function paceView(pace: MilestonePace): PaceView {
  const { mode, manual, weekly, weeksNeeded, applied } = pace
  const message = weeksShortfall(pace)
  return {
    manual,
    mode,
    paused: mode === 'measured' && applied?.source !== 'measured',
    weeks: weekly.length,
    weeksNeeded,
    measured: message === undefined ? { weeks: weekly.length, low: Math.min(...weekly), high: Math.max(...weekly) } : undefined,
    message,
  }
}

/** Seam B: the milestone's pace for the Inputs screen. */
export function paceOf(storage: Storage, teamId: string, team: TeamFacts, settings: ForecastSettings, today: string): PaceView | undefined {
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return undefined
  return paceView(milestonePace(milestone, team, storage.paceSetting(teamId, milestone.id), settings, today))
}

export function editPace(storage: Storage, teamId: string, edit: PaceEdit, settings: ForecastSettings, today: string): EditResult {
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return refuse('Define the milestone first.')
  const setting = storage.paceSetting(teamId, milestone.id)
  const manual = setting?.manual
  switch (edit.kind) {
    case 'useMeasuredPace': {
      const shortfall = weeksShortfall(milestonePace(milestone, teamFacts(storage, teamId), setting, settings, today))
      if (shortfall !== undefined) return refuse(shortfall)
      storage.savePaceSetting({ teamId, milestoneId: milestone.id, mode: 'measured', manual })
      return { ok: true }
    }
    case 'useManualPace':
      if (!manual) return refuse('Enter a manual range first.')
      storage.savePaceSetting({ teamId, milestoneId: milestone.id, mode: 'manual', manual })
      return { ok: true }
  }
}

/**
 * Sums daily samples into `periodDays`-long periods ending as `today` starts, oldest first, keeping only whole
 * periods: a part-period at the start (such as the one installation fell in) is dropped. Feeding daily counts into a
 * weekly forecast would make it about 7 times too slow, so samples of any other length are rejected.
 */
function periodCounts(samples: readonly ThroughputSample[], periodDays: number, today: string): number[] {
  const wrong = samples.find((sample) => sample.periodDays !== 1)
  if (wrong) throw new Error(`Expected daily throughput samples; got one of ${wrong.periodDays} days.`)
  const end = Date.parse(`${today}T00:00:00Z`) / MS_PER_DAY
  const periods = Math.floor(samples.length / periodDays)
  const counts = new Array<number>(periods).fill(0)
  for (const sample of samples) {
    const period = periods - 1 - Math.floor((end - 1 - Date.parse(sample.periodStart) / MS_PER_DAY) / periodDays)
    if (period >= 0) counts[period]! += sample.count
  }
  return counts
}

/** The periods from the first with a finished ticket: before it, the milestone's work hadn't started. */
function fromFirstFinished(counts: number[]): number[] {
  const first = counts.findIndex((count) => count > 0)
  return first === -1 ? [] : counts.slice(first)
}
