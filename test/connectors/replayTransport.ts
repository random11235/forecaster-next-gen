import type { Transport } from '../../src/connectors/connector.js'
import { describeRequest, requestOf, type Recording } from './recording.js'

/**
 * Seam C's transport: a fetch that answers each request from the recording with the same method, URL and body, and
 * throws, naming the request, when there is none, so a missing recording never passes silently. It throws an `Error`,
 * not the `TypeError` a network failure is, so no connector mistakes it for the tracker being unavailable.
 */
export function replayTransport(recordings: Recording[]): Transport {
  const byRequest = new Map(recordings.map((recording) => [describeRequest(recording.request), recording.response]))
  return async (url, init) => {
    const request = describeRequest(requestOf(url, init))
    const response = byRequest.get(request)
    if (!response) throw new Error(`No recording for ${request}`)
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } })
  }
}
