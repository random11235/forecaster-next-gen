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
  currentCount: number
  /** Children done so far. */
  doneCount: number
  /** Its commit, or undefined when the EM hasn't committed it. */
  commit: CommitView | undefined
}

/** The milestone's epics in rank order, as the team's facts and standing commits have them now. */
export function milestoneEpics(milestone: Milestone, team: TeamFacts): MilestoneEpic[] {
  const byId = new Map(team.facts.workItems.map((item) => [item.id, item]))
  return milestone.epicIds.map((epicId) => {
    const epic = byId.get(epicId)
    const commit = team.commits.get(epicId)
    const children = childrenOf(team.facts.workItems, epicId)
    return {
      epicId,
      key: epic?.sourceKey ?? epicId,
      name: epic?.title ?? epic?.sourceKey ?? epicId,
      currentCount: children.length,
      doneCount: children.filter((child) => child.doneAt !== undefined).length,
      commit: commit && { baseline: commit.baseline },
    }
  })
}

/** The count the epic's growth applies to: its commit's baseline, or, uncommitted, its current count as a provisional baseline. */
export function baselineOf(epic: MilestoneEpic): number {
  return epic.commit?.baseline ?? epic.currentCount
}
