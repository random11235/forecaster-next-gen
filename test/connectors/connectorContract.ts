import type { Connector, Transport } from '../../src/connectors/connector.js'
import type { Wait } from '../../src/connectors/remote.js'
import type { Connection } from '../../src/model/connection.js'
import type { Recording } from './recording.js'
import { replayTransport } from './replayTransport.js'
import type { Queries, Scenario, TrackerCases } from './scenarios.js'

/**
 * A connector as the contract suite tests it (Seam C): built on its tracker's recorded raw responses, replayed, so the
 * suite runs offline. Each tracker's synthetic repo or space holds the same cases, seeded by `scripts/synthetic/`,
 * whose manifest maps each case's role to its ticket.
 */
export interface ContractSubject {
  /** On the synthetic repo or space, with a token the tracker accepts. */
  synthetic(): Connector
  /** On the synthetic repo or space, with a token the tracker refuses. */
  refusedToken(): Connector
  /** On a repo or project that doesn't exist. */
  unknown(): Connector
  /** With no network: its transport rejects every request, as `fetch` does offline. */
  unreachable(): Connector
  /** On the synthetic repo or space, replaying no recordings: every request it makes is unrecorded. */
  unrecorded(): Connector
  /**
   * On the synthetic repo or space, its tracker rate limiting the first `times` answers to each request with a 429,
   * asking to retry after `retryAfter` seconds when given. `waits` records each backoff, in milliseconds; none is
   * waited out.
   */
  rateLimited(times: number, retryAfter?: string): { connector: Connector; waits: number[] }
  queries: Queries
  /** A synthetic ticket's id, by its role in the manifest. */
  idOf(role: string): string
  /** When the seed script's batches of finishes ran: `cut` falls between the early and later ones. */
  batches: { laterStart: string; laterEnd: string; cut: string }
}

/** Recordings keep no headers, so any credential stands in for the one they were recorded with. */
const REPLAYED_CREDENTIAL = 'replayed-token'

/** What `fetch` rejects with when the network is down. */
const offline: Transport = async () => {
  throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') })
}

/** A backoff that is never waited out. */
const noWait: Wait = async () => {}

/** `transport`, behind a tracker that answers each request with a 429 its first `times` times. */
function rateLimiting(transport: Transport, times: number, retryAfter: string | undefined): Transport {
  const limited = new Map<string, number>()
  return async (url, init) => {
    const request = `${init?.method ?? 'GET'} ${url} ${String(init?.body ?? '')}`
    const count = limited.get(request) ?? 0
    if (count >= times) return transport(url, init)
    limited.set(request, count + 1)
    const headers: Record<string, string> = retryAfter === undefined ? {} : { 'retry-after': retryAfter }
    return new Response('{"message":"rate limited"}', { status: 429, headers: { 'content-type': 'application/json', ...headers } })
  }
}

/** A tracker's connector, as the contract suite tests it, on what `scripts/record.ts` recorded for its cases. */
export function replayedSubject<C extends Connection>(tracker: {
  connect: (connection: C, credential: string, transport: Transport, wait: Wait) => Connector
  cases: TrackerCases<C>
  recordings: Record<Scenario, Recording[]>
  /** A synthetic ticket's id by its role, from the tracker's manifest. */
  idOf: (role: string) => string | undefined
  /** The manifest's batches. */
  batches: { later_start: string; later_end: string; cut: string }
}): ContractSubject {
  const { connect, cases, recordings, batches } = tracker
  const synthetic = cases.scenarios.synthetic.connection
  const replaying = (scenario: Scenario) =>
    connect(cases.scenarios[scenario].connection, REPLAYED_CREDENTIAL, replayTransport(recordings[scenario]), noWait)
  return {
    synthetic: () => replaying('synthetic'),
    refusedToken: () => replaying('refusedToken'),
    unknown: () => replaying('unknown'),
    unreachable: () => connect(synthetic, REPLAYED_CREDENTIAL, offline, noWait),
    unrecorded: () => connect(synthetic, REPLAYED_CREDENTIAL, replayTransport([]), noWait),
    rateLimited: (times, retryAfter) => {
      const waits: number[] = []
      const transport = rateLimiting(replayTransport(recordings.synthetic), times, retryAfter)
      const connector = connect(synthetic, REPLAYED_CREDENTIAL, transport, async (ms) => {
        waits.push(ms)
      })
      return { connector, waits }
    },
    queries: cases.queries,
    idOf: (role) => {
      const id = tracker.idOf(role)
      if (id === undefined) throw new Error(`No synthetic ticket has the role ${role}`)
      return id
    },
    batches: { laterStart: batches.later_start, laterEnd: batches.later_end, cut: batches.cut },
  }
}
