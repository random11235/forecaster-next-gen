/**
 * One raw response a tracker gave, and the request that got it. Recorded from the synthetic trackers only, trimmed to
 * the fields the connector reads. Headers are left out of both: the request's carry the token.
 *
 * `scripts/record.ts`, which node runs directly, imports this file: keep its runtime imports to none but `node:`.
 */
export interface Recording {
  request: RecordedRequest
  response: { status: number; body: unknown }
}

/** A request as a recording keeps it: method, URL, and body when it has one; never its headers. */
export interface RecordedRequest {
  method: string
  url: string
  body?: string
}

/** The request a transport was asked to make, as a recording keeps it. */
export function requestOf(url: string, init?: RequestInit): RecordedRequest {
  return { method: init?.method ?? 'GET', url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) }
}

/** The request as a recording names it, one string per distinct request: method, URL, and body when it has one. */
export function describeRequest({ method, url, body }: RecordedRequest): string {
  return body === undefined ? `${method} ${url}` : `${method} ${url} ${body}`
}
