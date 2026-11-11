import type { Transport } from '../../src/connectors/connector.js'
import type { Wait } from '../../src/connectors/remote.js'

// What the backoff tests share, beside the contract suite and in each tracker's folder: a stand-in tracker that keeps
// what it was sent, and waits that are never waited out.

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

/** A backoff that is never waited out. */
export const noWait: Wait = async () => {}

/** A backoff that fails the test if it is waited at all. */
export const mustNotWait: Wait = async () => {
  throw new Error('waited')
}

/** A backoff that is never waited out; `waits` keeps each wait asked for, in milliseconds. */
export function recordingWait(): { wait: Wait; waits: number[] } {
  const waits: number[] = []
  return {
    waits,
    wait: async (ms) => {
      waits.push(ms)
    },
  }
}
