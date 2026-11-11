import type { FailedCall, Ticket, Transport } from './connector.js'

/**
 * What the connectors that reach a tracker over the network (GitHub, Jira) share: sending a request, backing off a
 * rate-limited tracker, the failures a
 * response's status stands for, keeping a query inside the connection, and leaving out tickets finished too long ago.
 *
 * `scripts/record.ts`, which node runs directly, imports this file: keep its runtime imports to none but `node:`.
 */

/** A tracker's response: its status, its headers, and its body, parsed as JSON where it is JSON, else its text. */
export interface Received {
  status: number
  headers: Headers
  body: unknown
}

/** A response body as JSON where it is JSON, else as its text. */
export async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Waits `ms` milliseconds before a request is sent again: a timer, or Seam C's stand-in that doesn't wait. */
export type Wait = (ms: number) => Promise<void>

/** Waits on a timer. */
export const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** How a connector backs off a rate-limited tracker: which answers are rate limits, and how it waits. */
export interface Backoff {
  rateLimited: (received: Received) => boolean
  wait: Wait
}

/** How many times a rate-limited request is sent again before its rate limit is the answer. */
const RETRIES = 3
/** The first wait, doubling on each retry, when the tracker doesn't say how long to wait. */
const FIRST_WAIT_MS = 1000
/** The longest wait a tracker asks for that is waited out; a longer one is the answer at once. */
const LONGEST_WAIT_MS = 60_000

/** A header's value as a number, when it is one. */
function numberIn(headers: Headers, name: string): number | undefined {
  const given = headers.get(name)
  const value = given === null || given.trim() === '' ? NaN : Number(given)
  return Number.isFinite(value) ? value : undefined
}

/**
 * The wait a tracker asks for, in milliseconds, when it says: its `retry-after`, in seconds; else, for a limit spent
 * until a reset (GitHub's primary rate limit), until its `x-ratelimit-reset`, an instant in seconds since the epoch.
 */
function waitAskedFor(headers: Headers): number | undefined {
  const seconds = numberIn(headers, 'retry-after')
  if (seconds !== undefined && seconds >= 0) return seconds * 1000
  const reset = numberIn(headers, 'x-ratelimit-reset')
  return reset === undefined ? undefined : Math.max(0, reset * 1000 - Date.now())
}

/**
 * Sends a request through `transport`; `undefined` when the network failed. Only a network failure, which `fetch`
 * rejects with a `TypeError`, stands for `unavailable`: anything else the transport throws (Seam C's replay of a
 * request it has no recording for, say) is not the tracker's answer, so it propagates.
 *
 * A rate-limited answer is sent again after a wait, up to `RETRIES` times: what the tracker asks for (its
 * `retry-after`, or its rate limit's reset), else doubling from a second. Then, or at once when the tracker asks for
 * longer than a minute, the rate limit is the answer. Nothing else is sent again.
 */
export async function send(transport: Transport, url: string, init: RequestInit, backoff: Backoff): Promise<Received | undefined> {
  for (let retry = 0; ; retry++) {
    const received = await sendOnce(transport, url, init)
    if (!received || !backoff.rateLimited(received) || retry === RETRIES) return received
    const wait = waitAskedFor(received.headers) ?? FIRST_WAIT_MS * 2 ** retry
    if (wait > LONGEST_WAIT_MS) return received
    await backoff.wait(wait)
  }
}

/** One request, with no backoff. */
async function sendOnce(transport: Transport, url: string, init: RequestInit): Promise<Received | undefined> {
  try {
    const response = await transport(url, init)
    return { status: response.status, headers: response.headers, body: await bodyOf(response) }
  } catch (error) {
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/** The failure an unsuccessful status stands for, other than a refused query. */
export function failureOf(status: number): FailedCall {
  if (status === 401) return { ok: false, failure: 'unauthorised' }
  if (status === 404) return { ok: false, failure: 'notFound' }
  return { ok: false, failure: 'unavailable' }
}

/** How a tracker's query language could reach past the connection it is wrapped in. */
export interface QueryScope {
  /** A clause naming where to look, which would reach past the connection's repo or project. */
  reachesOut: RegExp
  /** A quoted value, whose parentheses are text, not grouping. Must be global. */
  quoted: RegExp
}

/**
 * True when the query stays inside the parentheses the connector wraps it in, so the connection's own clause holds for
 * all of it: no clause naming somewhere else, and no `)` outside quotes closing the wrapper. A quote left open is not
 * a value, so parentheses after it still count.
 */
export function staysInScope(query: string, scope: QueryScope): boolean {
  if (scope.reachesOut.test(query)) return false
  let depth = 0
  for (const char of query.replace(scope.quoted, '')) {
    if (char === '(') depth++
    if (char === ')' && --depth < 0) return false
  }
  return true
}

/** The tickets still open, or finished at or after `finishedSince`, a UTC instant. */
export function finishedSince(tickets: Ticket[], since: string): Ticket[] {
  const cut = Date.parse(since)
  return tickets.filter((ticket) => ticket.finishedAt === undefined || Date.parse(ticket.finishedAt) >= cut)
}
