import type { Milestone } from '../model/milestone.js'
import { categoryLookup, type StatusCategory } from '../model/workflow.js'
import { childrenOf, type WorkItem, type WorkItemEvent } from '../model/workItem.js'
import type { StandingCommit } from '../samples/commits.js'
import type { TeamFacts } from './teamFacts.js'

/** An epic's commit as the screens show it: its baseline, the children it had when committed, and how it was made. */
export type CommitView =
  | { baseline: number; source: 'inTool' }
  | {
      baseline: number
      source: 'label'
      /** The commit label has since come off the epic. The commit stands until the EM acts on it. */
      labelRemoved: boolean
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
  /** Its commit, or undefined when it isn't committed. */
  commit: CommitView | undefined
  /** The epic's own status is mapped to started; its children's statuses play no part. */
  inProgress: boolean
  /** The epic is in a status, or has a label, of the workflow's blocked rule. It stays in the milestone and forecast. */
  blocked: boolean
  /** The epic carries the workflow's commit label now, whether or not a commit stands. */
  hasCommitLabel: boolean
}

/** The milestone's epics in rank order, as the team's facts and standing commits have them now. */
export function milestoneEpics(milestone: Milestone, team: TeamFacts): MilestoneEpic[] {
  const byId = new Map(team.facts.workItems.map((item) => [item.id, item]))
  const inMilestone = new Set(milestone.epicIds)
  const lastStatus = new Map<string, WorkItemEvent>()
  for (const event of team.facts.events) {
    if (event.kind !== 'status' || !inMilestone.has(event.itemId)) continue
    const last = lastStatus.get(event.itemId)
    if (!last || Date.parse(event.at) >= Date.parse(last.at)) lastStatus.set(event.itemId, event)
  }
  const category = categoryLookup(team.workflow)
  const { blockedRule, commitLabel } = team.workflow

  return milestone.epicIds.map((epicId) => {
    const epic = byId.get(epicId)
    const commit = team.commits.get(epicId)
    const children = childrenOf(team.facts.workItems, epicId)
    const status = lastStatus.get(epicId)?.to
    const statusCategory = lastStatus.has(epicId) ? category(status) : categoryFromTimes(epic)
    const hasCommitLabel = commitLabel !== undefined && (epic?.labels ?? []).includes(commitLabel)
    return {
      epicId,
      key: epic?.sourceKey ?? epicId,
      name: epic?.title ?? epic?.sourceKey ?? epicId,
      currentCount: children.length,
      doneCount: children.filter((child) => child.doneAt !== undefined).length,
      commit: commit && commitView(commit, hasCommitLabel),
      inProgress: statusCategory === 'started',
      blocked:
        (status !== undefined && blockedRule.statuses.includes(status)) ||
        (epic?.labels ?? []).some((label) => blockedRule.labels.includes(label)),
      hasCommitLabel,
    }
  })
}

/** The count the epic's growth applies to: its commit's baseline, or, uncommitted, its current count as a provisional baseline. */
export function baselineOf(epic: MilestoneEpic): number {
  return epic.commit?.baseline ?? epic.currentCount
}

function commitView(commit: StandingCommit, hasCommitLabel: boolean): CommitView {
  if (commit.source === 'inTool') return { baseline: commit.baseline, source: 'inTool' }
  return { baseline: commit.baseline, source: 'label', labelRemoved: !hasCommitLabel }
}

/** An epic with no status history is where the connector's times put it. */
function categoryFromTimes(epic: WorkItem | undefined): StatusCategory {
  if (epic?.doneAt !== undefined) return 'done'
  if (epic?.cancelledAt !== undefined) return 'cancelled'
  return epic?.startedAt !== undefined ? 'started' : 'notStarted'
}
