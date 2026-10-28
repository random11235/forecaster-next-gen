import { ENGINE_VERSION, type SimulationCase, type ThroughputRange } from '../engine/index.js'
import { epicGrowth, epicSizes, type TeamGrowth } from './growth.js'
import { baselineOf, type MilestoneEpic } from './milestoneEpics.js'
import type { ForecastSettings } from './settings.js'

/**
 * The engine case for the milestone's 'when' forecast, starting `today`, at the pace `milestonePace` applies: the
 * manual range, or measured weekly counts.
 * Each of the milestone's epics grows from its baseline (`baselineOf`) as `epicGrowth` says, and an epic with no
 * baseline children draws its size from `epicSizes`.
 */
export function buildCase(
  epics: readonly MilestoneEpic[],
  growth: TeamGrowth,
  throughputSamples: number[] | ThroughputRange,
  settings: ForecastSettings,
  today: string,
): SimulationCase {
  return {
    engineVersion: ENGINE_VERSION,
    seed: settings.seed,
    trials: settings.trials,
    maxPeriods: settings.maxPeriods,
    question: { kind: 'when' },
    startDate: today,
    periodDays: settings.periodDays,
    scope: epics.map((epic, rank) => ({
      epicId: epic.epicId,
      rank,
      baseCount: baselineOf(epic),
      currentCount: epic.currentCount,
      doneCount: epic.doneCount,
      growth: epicGrowth(epic, growth, settings).growth,
    })),
    throughputSamples,
    epicSizeSamples: epicSizes(growth, settings),
    percentiles: settings.percentiles,
  }
}
