/** What a board status means to the Forecaster, whatever the board calls it. */
export type StatusCategory = 'notStarted' | 'started' | 'done' | 'cancelled'

export const STATUS_CATEGORIES: readonly StatusCategory[] = ['notStarted', 'started', 'done', 'cancelled']

/** One board status and its category. */
export interface StatusMapping {
  status: string
  category: StatusCategory
}

/** Issue types and labels; a ticket matching any of them matches the rule. Types are lower case, as ingested. */
export interface TypeOrLabelRule {
  types: string[]
  labels: string[]
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
  /** Tickets that are spikes: discovery work, which never counts as an epic starting. */
  spikeRule: TypeOrLabelRule
  /** A label that commits an epic when applied, if the team uses one. */
  commitLabel?: string
  /** What marks an epic as blocked. */
  blockedRule: StatusOrLabelRule
}

/**
 * The sample board's workflow, and the one a team has until the EM sets its own. Schema migration 2 writes the
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
    spikeRule: { types: ['spike'], labels: ['spike'] },
    blockedRule: { statuses: [], labels: ['blocked'] },
  }
}
