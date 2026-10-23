/**
 * A Forecaster concept, not tied to any ticketing tool: a name, a committed date and the epics in rank order.
 * Defined by the EM and stored locally; connectors supply only the epics and their tickets.
 */
export interface Milestone {
  id: string
  teamId: string
  name: string
  /** ISO calendar date, `YYYY-MM-DD`. */
  committedDate: string
  /** Work item IDs of the milestone's epics, highest rank first. */
  epicIds: string[]
}
