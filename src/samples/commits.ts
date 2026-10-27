import type { EpicCommit } from '../model/epicCommit.js'
import { categoryLookup, type StatusCategory, type WorkflowSettings } from '../model/workflow.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'

/** How an epic was committed: by the EM in the tool, or by applying the workflow's commit label. */
export type CommitSource = 'inTool' | 'label'

/** A commit that still stands, and how it was made. */
export interface StandingCommit extends EpicCommit {
  source: CommitSource
}

/**
 * The commits that still stand, by epic ID. An epic is committed by the EM in the tool, or by applying the workflow's
 * commit label, which records the epic's child count at that moment as its baseline. A pull-back (the epic moving from
 * started to not started, as the workflow reads its statuses) after a commit resets it, until the epic is committed
 * again; a move into a status of the blocked rule is not a pull-back, so a blocked epic keeps its commit, but leaving it
 * for not started is. While a commit stands, applying the label again doesn't replace it.
 */
export function standingCommits(
  commits: readonly EpicCommit[],
  facts: Facts,
  workflow: WorkflowSettings,
): Map<string, StandingCommit> {
  const category = categoryLookup(workflow)
  const blockedStatuses = new Set(workflow.blockedRule.statuses)
  const history = historyByItem(facts.events)

  const isBlocked = (status: string | undefined): boolean => status !== undefined && blockedStatuses.has(status)
  const lastPullBack = new Map<string, number>()
  for (const [itemId, { status }] of history) {
    // The category the epic was in before any blocked spell, so started, blocked, then not started is a pull-back.
    let before: StatusCategory | undefined
    for (const event of status) {
      if (!isBlocked(event.from)) before = category(event.from)
      if (isBlocked(event.to)) continue
      if (before === 'started' && category(event.to) === 'notStarted') lastPullBack.set(itemId, Date.parse(event.at))
      before = category(event.to)
    }
  }

  const made: StandingCommit[] = commits.map((commit) => ({ ...commit, source: 'inTool' }))
  const { commitLabel } = workflow
  if (commitLabel !== undefined) {
    const at = childCountAt(facts.workItems, history, category)
    for (const epic of facts.workItems) {
      if (epic.type !== 'epic') continue
      for (const event of history.get(epic.id)?.label ?? []) {
        if (event.to !== commitLabel) continue
        made.push({ teamId: epic.teamId, epicId: epic.id, committedAt: event.at, baseline: at(epic.id, event.at), source: 'label' })
      }
    }
  }

  const standing = new Map<string, StandingCommit>()
  for (const commit of made) {
    if ((lastPullBack.get(commit.epicId) ?? -Infinity) > Date.parse(commit.committedAt)) continue
    const earlier = standing.get(commit.epicId)
    if (!earlier || Date.parse(commit.committedAt) < Date.parse(earlier.committedAt)) standing.set(commit.epicId, commit)
  }
  return standing
}

interface ItemHistory {
  /** Each kind of event, in time order. */
  status: WorkItemEvent[]
  parent: WorkItemEvent[]
  label: WorkItemEvent[]
}

function historyByItem(events: readonly WorkItemEvent[]): Map<string, ItemHistory> {
  const history = new Map<string, ItemHistory>()
  for (const event of events) {
    if (event.kind === 'type') continue
    let item = history.get(event.itemId)
    if (!item) history.set(event.itemId, (item = { status: [], parent: [], label: [] }))
    item[event.kind].push(event)
  }
  for (const item of history.values()) {
    for (const events of [item.status, item.parent, item.label]) events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  }
  return history
}

/**
 * The children an epic had at a moment: tickets created by then whose parent then was the epic, and that weren't
 * cancelled then. A ticket with no parent history has had its current parent since it was created; one with no status
 * history was cancelled when the connector says.
 */
function childCountAt(
  workItems: readonly WorkItem[],
  history: ReadonlyMap<string, ItemHistory>,
  category: (status: string | undefined) => StatusCategory,
): (epicId: string, at: string) => number {
  const lastBy = (events: readonly WorkItemEvent[], time: number): WorkItemEvent | undefined =>
    events.filter((event) => Date.parse(event.at) <= time).at(-1)

  const parentAt = (item: WorkItem, time: number): string | undefined => {
    const changes = history.get(item.id)?.parent ?? []
    if (changes.length === 0) return item.parentId
    return (lastBy(changes, time) ?? { to: changes[0]!.from }).to
  }
  const cancelledAt = (item: WorkItem, time: number): boolean => {
    const statuses = history.get(item.id)?.status ?? []
    if (statuses.length === 0) return item.cancelledAt !== undefined && Date.parse(item.cancelledAt) <= time
    return category(lastBy(statuses, time)?.to) === 'cancelled'
  }

  return (epicId, at) => {
    const time = Date.parse(at)
    return workItems.filter(
      (item) => Date.parse(item.createdAt) <= time && parentAt(item, time) === epicId && !cancelledAt(item, time),
    ).length
  }
}
