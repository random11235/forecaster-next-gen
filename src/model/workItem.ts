/**
 * A ticket or epic as a connector produces it. Data minimisation: only IDs, types, parent links, labels and
 * status timestamps are kept. Epics alone keep their title, so the EM can recognise them on screen.
 */
export interface WorkItem {
  id: string
  teamId: string
  /** The key in the ticketing tool, e.g. `PAY-12`. */
  sourceKey: string
  /** The source's issue type in lower case; `'epic'` marks an epic. */
  type: string
  /** Epics only. */
  title?: string
  /** The current parent; earlier parents are in the item's `'parent'` events. */
  parentId?: string
  labels: string[]
  /** ISO timestamps. */
  createdAt: string
  startedAt?: string
  doneAt?: string
  cancelledAt?: string
  lastSyncedAt: string
}

/** One change to a work item: a status transition, a parent link, a type or a label. */
export interface WorkItemEvent {
  itemId: string
  /** ISO timestamp. */
  at: string
  kind: 'status' | 'parent' | 'type' | 'label'
  from?: string
  to?: string
}

/** A connector's normalised output for one team: its tickets and their history. */
export interface Facts {
  workItems: WorkItem[]
  events: WorkItemEvent[]
}

/** The epic's children now, done or not; cancelled children don't count. */
export function childrenOf(workItems: readonly WorkItem[], epicId: string): WorkItem[] {
  return workItems.filter((item) => item.parentId === epicId && item.cancelledAt === undefined)
}
