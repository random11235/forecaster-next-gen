import { ENGINE_VERSION, type SimulationCase, type ThroughputRange } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { Pace } from '../model/paceSetting.js'
import { childrenOf, type Facts } from '../model/workItem.js'
import { milestoneThroughput } from '../samples/throughput.js'
import type { ForecastSettings } from './settings.js'

/** The engine case, or why there is none: measured pace with no ticket under the milestone's epics done yet. */
export type BuiltCase = { ok: true; simulationCase: SimulationCase } | { ok: false; reason: 'noDoneTickets' }

/**
 * The engine case for the milestone's 'when' forecast, starting `today`.
 * v1 so far: every epic is uncommitted, so its current count is a provisional baseline and it grows by the
 * medium ambiguity range; an epic with no children draws its size from the default range.
 */
export function buildCase(
  milestone: Milestone,
  facts: Facts,
  pace: Pace,
  settings: ForecastSettings,
  today: string,
): BuiltCase {
  const throughputSamples = pace.mode === 'manual' ? manualRange(pace) : measuredSamples(milestone, facts, settings, today)
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
      scope: milestone.epicIds.map((epicId, rank) => {
        const children = childrenOf(facts.workItems, epicId)
        return {
          epicId,
          rank,
          baseCount: children.length,
          currentCount: children.length,
          doneCount: children.filter((child) => child.doneAt !== undefined).length,
          growth: settings.mediumAmbiguity,
        }
      }),
      throughputSamples,
      epicSizeSamples: settings.defaultEpicSize,
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
