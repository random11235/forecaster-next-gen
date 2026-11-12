import type { ChoicesOfKind, Connector, Failure, Ticket } from '../connector.js'

/** What a canned read answers: tickets in the shape a connector returns them, or a failure on cue. */
export type CannedRead = { tickets: Ticket[]; incomplete: boolean } | Failure

/** A canned connector's fixture, in the connector's own shape, so it can be kept as JSON. */
export interface CannedFixture {
  /** One list per kind, as a connector returns them. */
  milestoneChoices: ChoicesOfKind[] | Failure
  /** Keyed by query. */
  reads: Record<string, CannedRead>
}

/**
 * A connector that answers from a fixture, with no tracker, token or network: what Seam B tests and demo mode use.
 * A query the fixture doesn't hold matches nothing. A read leaves out tickets finished before `finishedSince`, as a
 * real connector does.
 */
export function cannedConnector(fixture: CannedFixture): Connector {
  return {
    milestoneChoices: async () => {
      const canned = fixture.milestoneChoices
      return Array.isArray(canned) ? { ok: true, kinds: canned } : { ok: false, ...canned }
    },
    read: async (query, finishedSince) => {
      const canned = Object.hasOwn(fixture.reads, query) ? fixture.reads[query]! : { tickets: [], incomplete: false }
      if (!('tickets' in canned)) return { ok: false, ...canned }
      const since = Date.parse(finishedSince)
      const tickets = canned.tickets.filter((ticket) => ticket.finishedAt === undefined || Date.parse(ticket.finishedAt) >= since)
      return { ok: true, tickets, incomplete: canned.incomplete }
    },
  }
}
