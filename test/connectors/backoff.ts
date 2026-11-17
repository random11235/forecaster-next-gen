import type { Wait } from '../../src/connectors/remote.js'

// What the backoff tests share, beside the contract suite and in each tracker's folder: waits that are never waited out.

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
