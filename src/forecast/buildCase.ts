import type { SimulationCase } from '../engine/index.js'
import type { Milestone } from '../model/milestone.js'
import type { PaceSetting } from '../model/paceSetting.js'
import type { Facts, WorkItem } from '../model/workItem.js'
import { milestoneThroughput } from '../samples/throughput.js'
import type { ForecastSettings } from './settings.js'

const ENGINE_VERSION = '1'

/**
 * The engine case for the milestone's 'when' forecast, starting `today`.
 * v1 so far: every epic is uncommitted, so its current count is a provisional baseline and it grows by the
 * medium ambiguity range; an epic with no children draws its size from the default range.
 * Undefined when the pace is measured but no ticket under the milestone's epics is done yet.
 */
export function buildCase(
  milestone: Milestone,
  facts: Facts,
  pace: PaceSetting,
  settings: ForecastSettings,
  today: string,
): SimulationCase | undefined {
  const throughputSamples =
    pace.mode === 'manual'
      ? { low: pace.low, high: pace.high }
      : milestoneThroughput(facts.workItems, milestone.epicIds, today, settings.periodDays)
  if (Array.isArray(throughputSamples) && throughputSamples.length === 0) return undefined

  return {
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
  }
}

/** The epic's children now, done or not; cancelled children don't count. */
export function childrenOf(workItems: readonly WorkItem[], epicId: string): WorkItem[] {
  return workItems.filter((item) => item.parentId === epicId && item.cancelledAt === undefined)
}
