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

/** Every kind of choice, in no order: GitHub has epics, labels and milestones; Jira fix versions, epics and labels. */
export const CHOICE_KINDS = ['epic', 'label', 'milestone', 'fixVersion'] as const

/** What a choice picks a milestone's tickets by. */
export type ChoiceKind = (typeof CHOICE_KINDS)[number]

/** The kind of choice `text` names, as a form or URL sends it; none when it names no kind. */
export function choiceKindOf(text: string): ChoiceKind | undefined {
  return CHOICE_KINDS.find((kind) => kind === text)
}

/**
 * Something the EM can pick a milestone's tickets by, with the query that reads them, in the tracker's syntax, built
 * only inside the connector. `forecast/` reads a query back, in that syntax, only to split a hand-edited one at its ORs
 * and find what each part names (`forecast/queryLanguage.ts`), so it can show it as the picks' chips.
 */
export interface Choice {
  kind: ChoiceKind
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
  kind: ChoiceKind
  choices: Choice[]
  pastLimit: boolean
}

/** The milestone choices, one list per kind, in the order the picker shows them; or one failure. */
export type ChoicesResult = { ok: true; kinds: ChoicesOfKind[] } | FailedCall

/** The choices of one kind a search of the tracker found, up to `CHOICES_LIMIT` of them; or one failure. */
export type SearchedChoices = { ok: true; choices: Choice[] } | FailedCall

/** How a connector reaches its tracker: `fetch`, or Seam C's replay of recorded responses. */
export type Transport = (url: string, init?: RequestInit) => Promise<Response>

export interface Connector {
  milestoneChoices(): Promise<ChoicesResult>
  /**
   * The choices of `kind` whose names match `text`, found by the tracker's own search, for a kind past the limit; each
   * with its query built as `milestoneChoices()` builds it. The tracker's search may match whole words only. A kind the
   * tracker has none of finds nothing.
   */
  searchChoices(kind: ChoiceKind, text: string): Promise<SearchedChoices>
  /** The tickets the query matches that are open or finished at or after `finishedSince`, a UTC instant. */
  read(query: string, finishedSince: string): Promise<ReadResult>
}
