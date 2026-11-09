import type { Connector } from '../../src/connectors/connector.js'

/**
 * A connector as the contract suite tests it (Seam C): built on its tracker's recorded raw responses, replayed, so the
 * suite runs offline. Each tracker's synthetic repo or space holds the same cases, seeded by `scripts/synthetic/`,
 * whose manifest maps each case's role to its ticket.
 */
export interface ContractSubject {
  /** On the synthetic repo or space, with a token the tracker accepts. */
  synthetic(): Connector
  /** On the synthetic repo or space, with a token the tracker refuses. */
  refusedToken(): Connector
  /** On a repo or project that doesn't exist. */
  unknown(): Connector
  /** With no network: its transport rejects every request, as `fetch` does offline. */
  unreachable(): Connector
  /** On the synthetic repo or space, replaying no recordings: every request it makes is unrecorded. */
  unrecorded(): Connector
  /** Queries in the tracker's own syntax. */
  queries: {
    /** The tickets of the open milestone "Search revamp", as its milestone choice reads them. */
    searchRevamp: string
    /** Valid, matching no ticket. */
    nothing: string
    /** One the tracker refuses. */
    invalid: string
    /** One reaching outside the connection's repo or project. */
    outOfScope: string
  }
  /** A synthetic ticket's id, by its role in the manifest. */
  idOf(role: string): string
  /** When the seed script's batches of finishes ran: `cut` falls between the early and later ones. */
  batches: { laterStart: string; laterEnd: string; cut: string }
}
