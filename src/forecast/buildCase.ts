import { ENGINE_VERSION, type SimulationCase, type ThroughputRange } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { Pace } from '../model/paceSetting.js'
import type { Facts } from '../model/workItem.js'
import { milestoneThroughput } from '../samples/throughput.js'
import { epicGrowth, epicSizes, type TeamGrowth } from './growth.js'
import { baselineOf, type MilestoneEpic } from './milestoneEpics.js'
import type { ForecastSettings } from './settings.js'
import type { TeamFacts } from './teamFacts.js'

/** The engine case, or why there is none: measured pace with no ticket under the milestone's epics done yet. */
export type BuiltCase = { ok: true; simulationCase: SimulationCase } | { ok: false; reason: 'noDoneTickets' }

/**
 * The engine case for the milestone's 'when' forecast, starting `today`.
 * Each of the milestone's epics grows from its baseline (`baselineOf`) as `epicGrowth` says, and an epic with no
 * baseline children draws its size from `epicSizes`.
 */
export function buildCase(
  milestone: Milestone,
  team: TeamFacts,
  epics: readonly MilestoneEpic[],
  growth: TeamGrowth,
  pace: Pace,
  settings: ForecastSettings,
  today: string,
): BuiltCase {
  const throughputSamples = pace.mode === 'manual' ? manualRange(pace) : measuredSamples(milestone, team.facts, settings, today)
  if (throughputSamples === undefined) return { ok: false, reason: 'noDoneTickets' }

  return {
    ok: true,
    simulationCase: {
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
    },
  }
}

function manualRange({ low, high }: ThroughputRange): ThroughputRange {
  return { low, high }
}

/**
 * Minimal and provisional: every whole week back to the first done ticket under the milestone's epics, or
 * undefined when none is done yet. The 8-week gate, the restart after a team change and the install cut-off are
 * owed by #22.
 */
function measuredSamples(milestone: Milestone, facts: Facts, settings: ForecastSettings, today: string): number[] | undefined {
  const samples = milestoneThroughput(facts.workItems, milestone.epicIds, today, settings.periodDays)
  return samples.length === 0 ? undefined : samples
}
