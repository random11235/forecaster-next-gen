/** What a board status means to the Forecaster, whatever the board calls it. */
export type StatusCategory = 'notStarted' | 'started' | 'done' | 'cancelled'

export const STATUS_CATEGORIES: readonly StatusCategory[] = ['notStarted', 'started', 'done', 'cancelled']

/** Each category as the EM reads it, in lower case. */
export const STATUS_CATEGORY_NAMES: Record<StatusCategory, string> = {
  notStarted: 'not started',
  started: 'started',
  done: 'done',
  cancelled: 'cancelled',
}

/** One board status and its category. */
export interface StatusMapping {
  status: string
  category: StatusCategory
}

/** Statuses and labels (flags); an epic in any of the statuses, or with any of the labels, matches the rule. */
export interface StatusOrLabelRule {
  statuses: string[]
  labels: string[]
}

/** How the team's board works, set by the EM on the Inputs screen. One per team. */
export interface WorkflowSettings {
  teamId: string
  /** Each board status the EM has mapped, in the order the EM sees them. */
  statuses: StatusMapping[]
  /** The status where cycle time starts; one mapped to started. */
  startedStatus: string
  /** A label that commits an epic when applied, if the team uses one. */
  commitLabel?: string
  /** What marks an epic as blocked. */
  blockedRule: StatusOrLabelRule
}

/** A lookup of each status's category under the workflow. A status the EM hasn't mapped counts as not started. */
export function categoryLookup(workflow: WorkflowSettings): (status: string | undefined) => StatusCategory {
  const categoryOf = new Map(workflow.statuses.map((mapping) => [mapping.status, mapping.category]))
  return (status) => (status !== undefined && categoryOf.get(status)) || 'notStarted'
}

/**
 * The sample board's workflow (less its commit label), and the one a team has until the EM sets its own. Schema migration 2 writes the
 * same settings into data files from before workflow settings existed.
 */
export function defaultWorkflowSettings(teamId: string): WorkflowSettings {
  return {
    teamId,
    statuses: [
      { status: 'To Do', category: 'notStarted' },
      { status: 'In Progress', category: 'started' },
      { status: 'Done', category: 'done' },
      { status: 'Cancelled', category: 'cancelled' },
    ],
    startedStatus: 'In Progress',
    blockedRule: { statuses: [], labels: ['blocked'] },
  }
}
