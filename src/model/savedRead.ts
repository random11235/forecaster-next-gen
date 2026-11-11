import type { Ticket } from '../connectors/connector.js'

/**
 * A query's last read, saved so screens open without a network call (#183): its tickets (ids and finish times only),
 * whether the tracker returned them all, and when it was read. Each read of the query replaces it whole.
 */
export interface SavedRead {
  tickets: Ticket[]
  /** True when the tracker didn't return every ticket the query matched. */
  incomplete: boolean
  /** The UTC instant the read was made. */
  readAt: string
}
