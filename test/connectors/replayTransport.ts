import type { Transport } from '../../src/connectors/connector.js'

/**
 * One raw response a tracker gave, and the request that got it. Recorded from the synthetic trackers only, trimmed to
 * the fields the connector reads. Headers are left out of both: the request's carry the token.
 */
export interface Recording {
  request: { method: string; url: string; body?: string }
  response: { status: number; body: unknown }
}

/** The request as a recording names it: method, URL, and body when it has one. */
export function describeRequest({ method, url, body }: Recording['request']): string {
  return body === undefined ? `${method} ${url}` : `${method} ${url} ${body}`
}

/**
 * Seam C's transport: a fetch that answers each request from the recording with the same method, URL and body, and
 * throws, naming the request, when there is none, so a missing recording never passes silently.
 */
export function replayTransport(recordings: Recording[]): Transport {
  const byRequest = new Map(recordings.map((recording) => [describeRequest(recording.request), recording.response]))
  return async (url, init) => {
    const request = describeRequest({ method: init?.method ?? 'GET', url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) })
    const response = byRequest.get(request)
    if (!response) throw new Error(`No recording for ${request}`)
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } })
  }
}
