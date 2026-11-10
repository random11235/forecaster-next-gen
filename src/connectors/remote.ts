import type { FailedCall, Ticket, Transport } from './connector.js'

/**
 * What the connectors that reach a tracker over the network (GitHub, Jira) share: sending a request, the failures a
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

/**
 * Sends a request through `transport`; `undefined` when the network failed. Only a network failure, which `fetch`
 * rejects with a `TypeError`, stands for `unavailable`: anything else the transport throws (Seam C's replay of a
 * request it has no recording for, say) is not the tracker's answer, so it propagates.
 */
export async function send(transport: Transport, url: string, init: RequestInit): Promise<Received | undefined> {
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
