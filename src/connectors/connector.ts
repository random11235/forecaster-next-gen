/**
 * The one interface both trackers implement (#154, from the connector-shape grill in #134). Everything
 * tracker-specific (auth, paging, backoff, query syntax, which tickets count, when one finished) stays inside a
 * connector; `forecast/` and the screens see only these types. A connector is built from a connection, a token and
 * a transport (an injected `fetch`); `app/` builds it and passes it in.
 */

/** All the tool holds of a ticket. */
export interface Ticket {
  /** Opaque and stable: the GitHub node id, or the Jira numeric id (not the key, which changes on a move). */
  id: string
  /** The UTC instant of the ticket's last finish; absent while it is open. */
  finishedAt?: string
}

/**
 * Why a connector couldn't answer. Connectors don't word failures; the screens do.
 * - `invalidQuery`: the tracker refused the query, with its own message.
 * - `outOfScope`: the query reaches outside the connection's repo or project.
 * - `notFound`: the repo or project doesn't exist, or the token can't see it.
 * - `unauthorised`: the token was refused.
 * - `unavailable`: the network, or rate limiting after backoff.
 */
export type Failure =
  | { failure: 'invalidQuery'; message: string }
  | { failure: 'outOfScope' | 'notFound' | 'unauthorised' | 'unavailable' }

/** A failed call: one failure, and nothing else. */
export type FailedCall = { ok: false } & Failure

/** A read's tickets, flagged incomplete when the tracker didn't return them all; or one failure. Matching nothing is an empty list. */
export type ReadResult = { ok: true; tickets: Ticket[]; incomplete: boolean } | FailedCall

/**
 * Something the EM can pick a milestone's tickets by, with the query that reads them, built inside the connector
 * (the only place that knows the tracker's syntax). Its kinds are specified with the picker.
 */
export interface Choice {
  kind: string
  name: string
  query: string
}

/** The most choices of one kind a connector lists; past it, the picker searches that kind in the tracker instead. */
export const CHOICES_LIMIT = 100

/**
 * One kind's milestone choices, up to `CHOICES_LIMIT` of them; `pastLimit` when the tracker has more than that of the
 * kind, so the list isn't all of them.
 */
export interface ChoicesOfKind {
  kind: string
  choices: Choice[]
  pastLimit: boolean
}

/** The milestone choices, one list per kind, in the order the picker shows them; or one failure. */
export type ChoicesResult = { ok: true; kinds: ChoicesOfKind[] } | FailedCall

/** How a connector reaches its tracker: `fetch`, or Seam C's replay of recorded responses. */
export type Transport = (url: string, init?: RequestInit) => Promise<Response>

export interface Connector {
  milestoneChoices(): Promise<ChoicesResult>
  /** The tickets the query matches that are open or finished at or after `finishedSince`, a UTC instant. */
  read(query: string, finishedSince: string): Promise<ReadResult>
}
