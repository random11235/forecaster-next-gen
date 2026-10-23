import type { WorkItem } from '../model/workItem.js'
import type { Storage } from '../storage/storage.js'

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

/** What the Milestone forecast screen shows. */
export type MilestoneForecastView =
  | { kind: 'noMilestone' }
  | { kind: 'milestone'; name: string; committedDate: string; epics: EpicRow[] }

/** The Milestone forecast screen for the team's milestone, from what is stored. */
export function milestoneForecastView(storage: Storage, teamId: string): MilestoneForecastView {
  const milestone = storage.milestones(teamId)[0]
  if (!milestone) return { kind: 'noMilestone' }

  const { workItems } = storage.facts(teamId)
  const byId = new Map(workItems.map((item) => [item.id, item]))
  const children = (epicId: string): WorkItem[] =>
    workItems.filter((item) => item.parentId === epicId && item.cancelledAt === undefined)

  return {
    kind: 'milestone',
    name: milestone.name,
    committedDate: milestone.committedDate,
    epics: milestone.epicIds.map((epicId) => {
      const epic = byId.get(epicId)
      return {
        epicId,
        key: epic?.sourceKey ?? epicId,
        name: epic?.title ?? epic?.sourceKey ?? epicId,
        itemsNow: children(epicId).length,
        status: 'notCommitted',
      }
    }),
  }
}
