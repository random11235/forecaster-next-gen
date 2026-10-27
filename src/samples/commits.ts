import type { EpicCommit } from '../model/epicCommit.js'
import { categoryLookup, type StatusCategory, type WorkflowSettings } from '../model/workflow.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'

/** How an epic was committed: by the EM in the tool, or by applying the workflow's commit label. */
export type CommitSource = 'inTool' | 'label'

/** A commit that still stands, and how it was made. */
export interface StandingCommit extends EpicCommit {
  source: CommitSource
}

/** An epic's commits as they stand, from the EM's commits in the tool and the facts' label and status history. */
export interface Commits {
  /** The commits that still stand, by epic ID. */
  standing: Map<string, StandingCommit>
  /** Epics with a commit made by the commit label that a pull-back has since reset. */
  labelCommitsReset: Set<string>
}

/**
 * The commits that still stand, by epic ID, and the epics whose label commit a pull-back reset. An epic is committed by the EM in the tool, or by applying the workflow's
 * commit label, which records the epic's child count at that moment as its baseline. A pull-back (the epic moving from
 * started to not started, as the workflow reads its statuses) after a commit resets it, until the epic is committed
 * again. A blocked epic keeps its commit: a move into or out of a status of the blocked rule is not a pull-back, nor
 * is a move to not started while the epic carries a label of the rule. An epic out of scope is removed from the
 * milestone instead. The two ways of committing count the same: the commit that stands is the first made since the last
 * pull-back, so while one stands, neither the EM nor applying the label again replaces it.
 */
export function standingCommits(
  commits: readonly EpicCommit[],
  facts: Facts,
  workflow: WorkflowSettings,
): Commits {
  const category = categoryLookup(workflow)
  const blockedStatuses = new Set(workflow.blockedRule.statuses)
  const history = historyByItem(facts.events)

  const isBlocked = (status: string | undefined): boolean => status !== undefined && blockedStatuses.has(status)
  const blockedLabelAt = blockedLabelAtTime(facts.workItems, history, workflow.blockedRule.labels)
  const lastPullBack = new Map<string, number>()
  for (const [itemId, { status }] of history) {
    // The category of the status the move left, or undefined for a blocked one. A move with no `from` left the status
    // the last move went to.
    let before: StatusCategory | undefined
    for (const event of status) {
      if (event.from !== undefined) before = isBlocked(event.from) ? undefined : category(event.from)
      const pulledBack = before === 'started' && !isBlocked(event.to) && category(event.to) === 'notStarted'
      if (pulledBack && !blockedLabelAt(itemId, event.at)) lastPullBack.set(itemId, Date.parse(event.at))
      before = isBlocked(event.to) ? undefined : category(event.to)
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

  // The earliest since the last pull-back stands, however it was made.
  const standing = new Map<string, StandingCommit>()
  const labelCommitsReset = new Set<string>()
  for (const commit of made) {
    if ((lastPullBack.get(commit.epicId) ?? -Infinity) > Date.parse(commit.committedAt)) {
      if (commit.source === 'label') labelCommitsReset.add(commit.epicId)
      continue
    }
    const earliest = standing.get(commit.epicId)
    if (!earliest || Date.parse(commit.committedAt) < Date.parse(earliest.committedAt)) standing.set(commit.epicId, commit)
  }
  return { standing, labelCommitsReset }
}

/**
 * Whether an item carried a label of the blocked rule at a moment: its labels now, less those added since and plus
 * those removed since.
 */
function blockedLabelAtTime(
  workItems: readonly WorkItem[],
  history: ReadonlyMap<string, ItemHistory>,
  blockedLabels: readonly string[],
): (itemId: string, at: string) => boolean {
  const labelsNow = new Map(workItems.map((item) => [item.id, item.labels]))
  return (itemId, at) => {
    const labels = new Set(labelsNow.get(itemId) ?? [])
    const time = Date.parse(at)
    const since = (history.get(itemId)?.label ?? []).filter((event) => Date.parse(event.at) > time)
    for (const event of since.reverse()) {
      if (event.to !== undefined) labels.delete(event.to)
      if (event.from !== undefined) labels.add(event.from)
    }
    return blockedLabels.some((label) => labels.has(label))
  }
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
