import type { Milestone } from '../model/milestone.js'
import { childrenOf } from '../model/workItem.js'
import type { TeamFacts } from './teamFacts.js'

/** An epic's commit as the screens show it: its baseline, the children it had when the EM committed it. */
export interface CommitView {
  baseline: number
}

/** A milestone's epic as it stands, the same on every screen and in the forecast. */
export interface MilestoneEpic {
  epicId: string
  /** The epic's key in the ticketing tool. */
  key: string
  /** The epic's title, or its key when it has none. */
  name: string
  /** Children now, done or not; cancelled children don't count. */
  itemsNow: number
  /** Its commit, whose baseline its growth applies to, or undefined when not committed: a wide range. */
  commit: CommitView | undefined
}

/** The milestone's epics in rank order, as the team's facts and standing commits have them now. */
export function milestoneEpics(milestone: Milestone, team: TeamFacts): MilestoneEpic[] {
  const byId = new Map(team.facts.workItems.map((item) => [item.id, item]))
  return milestone.epicIds.map((epicId) => {
    const epic = byId.get(epicId)
    const commit = team.commits.get(epicId)
    return {
      epicId,
      key: epic?.sourceKey ?? epicId,
      name: epic?.title ?? epic?.sourceKey ?? epicId,
      itemsNow: childrenOf(team.facts.workItems, epicId).length,
      commit: commit && { baseline: commit.baseline },
    }
  })
}

/** The count the epic's growth applies to: its commit's baseline, or, uncommitted, its current count as a provisional baseline. */
export function baselineOf(epic: MilestoneEpic): number {
  return epic.commit?.baseline ?? epic.itemsNow
}
