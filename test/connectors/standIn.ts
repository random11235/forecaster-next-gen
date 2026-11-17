import type { Transport } from '../../src/connectors/connector.js'

// What the stand-in trackers share, beside the contract suite and in each tracker's folder: a transport that keeps
// what it was sent, and the JSON responses they answer with.

/** A stand-in tracker answering each request with `answer`; `sent` keeps each request's URL, in order. */
export function answering(answer: Transport): { transport: Transport; sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    transport: (url, init) => {
      sent.push(url)
      return answer(url, init)
    },
  }
}

/** A stand-in tracker's JSON response, with any `headers` beside its content type. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}
