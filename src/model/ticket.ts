/** All the tool holds of a ticket, as a connector reads it and a saved read keeps it. */
export interface Ticket {
  /** Opaque and stable: the GitHub node id, or the Jira numeric id (not the key, which changes on a move). */
  id: string
  /** The UTC instant of the ticket's last finish; absent while it is open. */
  finishedAt?: string
}
