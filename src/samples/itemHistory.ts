import { categoryLookup, type StatusCategory, type WorkflowSettings } from '../model/workflow.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'

/** An item's events, by kind. */
export interface ItemHistory {
  /** Each kind of event, in time order. */
  status: WorkItemEvent[]
  parent: WorkItemEvent[]
  label: WorkItemEvent[]
}

/** Each item's events, by kind and in time order. */
export function historyByItem(events: readonly WorkItemEvent[]): Map<string, ItemHistory> {
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
 * cancelled then, as the workflow reads their statuses. A ticket with no parent history has had its current parent
 * since it was created; one with no status history was cancelled when the connector says.
 */
export function childCounter(facts: Facts, workflow: WorkflowSettings): (epicId: string, at: string) => number {
  return childCountAt(facts.workItems, historyByItem(facts.events), categoryLookup(workflow))
}

/** `childCounter`, from the history already sorted by item. */
export function childCountAt(
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
