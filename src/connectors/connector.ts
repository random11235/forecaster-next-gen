/**
 * The one interface both trackers implement (#154, from the connector-shape grill in #134). Everything
 * tracker-specific (auth, paging, backoff, query syntax, which tickets count, when one finished) stays inside a
 * connector; `forecast/` and the screens see only these types. A connector is built from a connection, a token and
 * a transport (an injected `fetch`); `app/` builds it and passes it in.
 */

import type { Choice, ChoiceKind } from '../model/choice.js'
import type { Failure } from '../model/failure.js'
import type { Ticket } from '../model/ticket.js'

// The record types a connector answers in live in model/, which saves them; its callers in forecast/ take them from here.
export type { Choice, ChoiceKind, Failure, Ticket }

/** A failed call: one failure, and nothing else. */
export type FailedCall = { ok: false } & Failure

/** A read's tickets, flagged incomplete when the tracker didn't return them all; or one failure. Matching nothing is an empty list. */
export type ReadResult = { ok: true; tickets: Ticket[]; incomplete: boolean } | FailedCall

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
