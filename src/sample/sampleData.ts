import type { Milestone } from '../model/milestone.js'
import type { Team } from '../model/team.js'
import { defaultWorkflowSettings, type WorkflowSettings } from '../model/workflow.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'

/** Canned data loaded on first launch, so the EM can see how the Forecaster works without connecting Jira. */
export interface SampleData {
  team: Team
  facts: Facts
  milestone: Milestone
  /** The sample board's workflow: To Do, In Progress, Done and Cancelled, with spikes by type or label. */
  workflow: WorkflowSettings
}

const TEAM_ID = 'sample-team'
const SYNCED_AT = '2026-10-19T07:10:00Z'

type State = 'toDo' | 'inProgress' | 'done' | 'cancelled'

interface SampleTicket {
  key: string
  type: string
  title?: string
  parent?: string
  /** The parent the ticket had before it was moved under `parent`, and when it moved. */
  movedFrom?: { parent: string; at: string }
  labels?: string[]
  createdAt: string
  state: State
  startedAt?: string
  /** When the ticket was done or cancelled. */
  endedAt?: string
}

const tickets: SampleTicket[] = [
  { key: 'PAY-1', type: 'epic', title: 'Card vaulting', createdAt: '2026-08-31T09:00:00Z', state: 'inProgress', startedAt: '2026-09-07T09:00:00Z' },
  { key: 'PAY-2', type: 'epic', title: 'Refunds', createdAt: '2026-08-31T09:00:00Z', state: 'inProgress', startedAt: '2026-09-21T09:00:00Z' },
  { key: 'PAY-3', type: 'epic', title: 'Receipts redesign', createdAt: '2026-09-01T09:00:00Z', state: 'toDo' },
  { key: 'PAY-4', type: 'epic', title: 'Fraud rules', createdAt: '2026-09-01T09:00:00Z', state: 'inProgress', startedAt: '2026-09-14T09:00:00Z' },

  // Card vaulting: 6 tickets now (PAY-17 was cancelled)
  { key: 'PAY-11', type: 'story', parent: 'PAY-1', createdAt: '2026-09-01T09:00:00Z', state: 'done', startedAt: '2026-09-07T09:00:00Z', endedAt: '2026-09-11T16:00:00Z' },
  { key: 'PAY-12', type: 'story', parent: 'PAY-1', createdAt: '2026-09-01T09:00:00Z', state: 'done', startedAt: '2026-09-08T09:00:00Z', endedAt: '2026-09-17T16:00:00Z' },
  { key: 'PAY-13', type: 'story', parent: 'PAY-1', createdAt: '2026-09-01T09:00:00Z', state: 'done', startedAt: '2026-09-15T09:00:00Z', endedAt: '2026-09-24T16:00:00Z' },
  { key: 'PAY-14', type: 'task', parent: 'PAY-1', createdAt: '2026-09-02T09:00:00Z', state: 'done', startedAt: '2026-09-28T09:00:00Z', endedAt: '2026-10-06T16:00:00Z' },
  { key: 'PAY-15', type: 'story', parent: 'PAY-1', createdAt: '2026-09-09T09:00:00Z', state: 'inProgress', startedAt: '2026-10-07T09:00:00Z' },
  { key: 'PAY-16', type: 'story', parent: 'PAY-1', createdAt: '2026-09-16T09:00:00Z', state: 'toDo' },
  { key: 'PAY-17', type: 'story', parent: 'PAY-1', createdAt: '2026-09-02T09:00:00Z', state: 'cancelled', endedAt: '2026-09-10T11:00:00Z' },

  // Refunds: 14 tickets now, including PAY-34, moved here from Receipts redesign
  { key: 'PAY-21', type: 'spike', parent: 'PAY-2', labels: ['spike'], createdAt: '2026-09-02T09:00:00Z', state: 'done', startedAt: '2026-09-21T09:00:00Z', endedAt: '2026-09-25T16:00:00Z' },
  { key: 'PAY-22', type: 'story', parent: 'PAY-2', createdAt: '2026-09-02T09:00:00Z', state: 'done', startedAt: '2026-09-29T09:00:00Z', endedAt: '2026-10-08T16:00:00Z' },
  { key: 'PAY-23', type: 'story', parent: 'PAY-2', createdAt: '2026-09-02T09:00:00Z', state: 'inProgress', startedAt: '2026-10-05T09:00:00Z' },
  { key: 'PAY-24', type: 'story', parent: 'PAY-2', createdAt: '2026-09-02T09:00:00Z', state: 'inProgress', startedAt: '2026-10-09T09:00:00Z' },
  { key: 'PAY-25', type: 'task', parent: 'PAY-2', createdAt: '2026-09-28T09:00:00Z', state: 'inProgress', startedAt: '2026-10-12T09:00:00Z' },
  { key: 'PAY-26', type: 'story', parent: 'PAY-2', createdAt: '2026-09-28T09:00:00Z', state: 'inProgress', startedAt: '2026-10-14T09:00:00Z' },
  { key: 'PAY-27', type: 'story', parent: 'PAY-2', createdAt: '2026-09-28T09:00:00Z', state: 'toDo' },
  { key: 'PAY-28', type: 'story', parent: 'PAY-2', createdAt: '2026-09-28T09:00:00Z', state: 'toDo' },
  { key: 'PAY-29', type: 'story', parent: 'PAY-2', createdAt: '2026-09-29T09:00:00Z', state: 'toDo' },
  { key: 'PAY-30', type: 'story', parent: 'PAY-2', createdAt: '2026-09-29T09:00:00Z', state: 'toDo' },
  { key: 'PAY-31', type: 'task', parent: 'PAY-2', createdAt: '2026-10-06T09:00:00Z', state: 'toDo' },
  { key: 'PAY-32', type: 'story', parent: 'PAY-2', createdAt: '2026-10-06T09:00:00Z', state: 'toDo' },
  { key: 'PAY-33', type: 'story', parent: 'PAY-2', createdAt: '2026-10-13T09:00:00Z', state: 'toDo' },
  { key: 'PAY-34', type: 'story', parent: 'PAY-2', movedFrom: { parent: 'PAY-3', at: '2026-10-07T10:00:00Z' }, createdAt: '2026-09-03T09:00:00Z', state: 'toDo' },

  // Receipts redesign: 3 tickets now
  { key: 'PAY-41', type: 'story', parent: 'PAY-3', createdAt: '2026-09-03T09:00:00Z', state: 'toDo' },
  { key: 'PAY-42', type: 'story', parent: 'PAY-3', createdAt: '2026-09-03T09:00:00Z', state: 'toDo' },
  { key: 'PAY-43', type: 'task', parent: 'PAY-3', createdAt: '2026-09-03T09:00:00Z', state: 'toDo' },

  // Fraud rules: an epic outside the milestone
  { key: 'PAY-51', type: 'story', parent: 'PAY-4', createdAt: '2026-09-02T09:00:00Z', state: 'done', startedAt: '2026-09-14T09:00:00Z', endedAt: '2026-09-22T16:00:00Z' },
  { key: 'PAY-52', type: 'story', parent: 'PAY-4', createdAt: '2026-09-02T09:00:00Z', state: 'done', startedAt: '2026-09-23T09:00:00Z', endedAt: '2026-10-02T16:00:00Z' },
  { key: 'PAY-53', type: 'story', parent: 'PAY-4', createdAt: '2026-09-02T09:00:00Z', state: 'inProgress', startedAt: '2026-10-05T09:00:00Z' },
  { key: 'PAY-54', type: 'story', parent: 'PAY-4', createdAt: '2026-09-15T09:00:00Z', state: 'toDo' },

  // KTLO: unparented bugs and chores
  { key: 'PAY-61', type: 'bug', labels: ['ktlo'], createdAt: '2026-09-08T09:00:00Z', state: 'done', startedAt: '2026-09-08T10:00:00Z', endedAt: '2026-09-09T15:00:00Z' },
  { key: 'PAY-62', type: 'bug', labels: ['ktlo'], createdAt: '2026-09-22T09:00:00Z', state: 'done', startedAt: '2026-09-23T09:00:00Z', endedAt: '2026-09-25T15:00:00Z' },
  { key: 'PAY-63', type: 'bug', createdAt: '2026-10-12T09:00:00Z', state: 'inProgress', startedAt: '2026-10-13T09:00:00Z' },
  { key: 'PAY-64', type: 'task', labels: ['ktlo'], createdAt: '2026-10-14T09:00:00Z', state: 'toDo' },
]

const STATUS_NAME: Record<State, string> = { toDo: 'To Do', inProgress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }

function workItem(row: SampleTicket): WorkItem {
  return {
    id: row.key,
    teamId: TEAM_ID,
    sourceKey: row.key,
    type: row.type,
    ...(row.title !== undefined && { title: row.title }),
    ...(row.parent !== undefined && { parentId: row.parent }),
    labels: row.labels ?? [],
    createdAt: row.createdAt,
    ...(row.startedAt !== undefined && { startedAt: row.startedAt }),
    ...(row.state === 'done' && row.endedAt !== undefined && { doneAt: row.endedAt }),
    ...(row.state === 'cancelled' && row.endedAt !== undefined && { cancelledAt: row.endedAt }),
    lastSyncedAt: SYNCED_AT,
  }
}

/** The history a connector would read from the changelog: status transitions, parent links and labels. */
function events(row: SampleTicket): WorkItemEvent[] {
  const itemId = row.key
  const history: WorkItemEvent[] = [{ itemId, at: row.createdAt, kind: 'status', to: STATUS_NAME.toDo }]
  const firstParent = row.movedFrom?.parent ?? row.parent
  if (firstParent !== undefined) history.push({ itemId, at: row.createdAt, kind: 'parent', to: firstParent })
  for (const label of row.labels ?? []) history.push({ itemId, at: row.createdAt, kind: 'label', to: label })
  if (row.movedFrom && row.parent !== undefined) {
    history.push({ itemId, at: row.movedFrom.at, kind: 'parent', from: row.movedFrom.parent, to: row.parent })
  }
  if (row.startedAt !== undefined) {
    history.push({ itemId, at: row.startedAt, kind: 'status', from: STATUS_NAME.toDo, to: STATUS_NAME.inProgress })
  }
  if (row.endedAt !== undefined) {
    const from = row.startedAt !== undefined ? STATUS_NAME.inProgress : STATUS_NAME.toDo
    history.push({ itemId, at: row.endedAt, kind: 'status', from, to: STATUS_NAME[row.state] })
  }
  return history
}

export const SAMPLE_DATA: SampleData = {
  team: { id: TEAM_ID, name: 'Payments (sample)', source: 'sample', sourceRef: 'PAY' },
  facts: { workItems: tickets.map(workItem), events: tickets.flatMap(events) },
  milestone: {
    id: 'sample-milestone',
    teamId: TEAM_ID,
    name: 'Checkout v2',
    committedDate: '2026-12-18',
    epicIds: ['PAY-1', 'PAY-2', 'PAY-3'],
  },
  workflow: defaultWorkflowSettings(TEAM_ID),
}
