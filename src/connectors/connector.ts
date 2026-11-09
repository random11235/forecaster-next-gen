/**
 * The one interface both trackers implement (#154, from the connector-shape grill in #134). Everything
 * tracker-specific (auth, paging, backoff, query syntax, which tickets count, when one finished) stays inside a
 * connector; `forecast/` and the screens see only these types. A connector is built from a connection, a token and
 * a transport (an injected `fetch`); `app/` builds it and passes it in.
 */

/** The tracker a team is connected to, and where in it the team's tickets live. */
export type Connection =
  | { tracker: 'github'; owner: string; repo: string }
  | { tracker: 'jira'; site: string; projectKey: string }

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
export type Failed = { ok: false } & Failure

/** A read's tickets, flagged incomplete when the tracker didn't return them all; or one failure. Matching nothing is an empty list. */
export type ReadResult = { ok: true; tickets: Ticket[]; incomplete: boolean } | Failed

/**
 * Something the EM can pick a milestone's tickets by, with the query that reads them, built inside the connector
 * (the only place that knows the tracker's syntax). Its kinds are specified with the picker.
 */
export interface Choice {
  kind: string
  name: string
  query: string
}

export type ChoicesResult = { ok: true; choices: Choice[] } | Failed

/** How a connector reaches its tracker: `fetch`, or Seam C's replay of recorded responses. */
export type Transport = (url: string, init?: RequestInit) => Promise<Response>

export interface Connector {
  milestoneChoices(): Promise<ChoicesResult>
  /** The tickets the query matches that are open or finished at or after `finishedSince`, a UTC instant. */
  read(query: string, finishedSince: string): Promise<ReadResult>
}
