import type { Connection } from '../../model/connection.js'
import type { Choice, Connector, FailedCall, ReadResult, Ticket, Transport } from '../connector.js'
import { failureOf as statusFailure, finishedSince, send, sleep, staysInScope, type QueryScope, type Received, type Wait } from '../remote.js'

/**
 * The GitHub connector, so far a skeleton that passes the contract suite's shape cases (#172). It reads through
 * GitHub's REST API: issue search, rather than GraphQL's, because only REST refuses a query it can't parse, with its own
 * message, where GraphQL silently matches nothing. Its full reads (leaf tickets, last finish, paging) come with the spec on which tickets count; until then a read is one page of search results, flagged
 * incomplete when there are more.
 */

const API = 'https://api.github.com'
const PAGE = 100

/**
 * Search wraps the query as `repo:… is:issue (query)`; a qualifier naming where to look would reach past the repo.
 * Search quotes values in double quotes only, with no escapes.
 */
const SCOPE: QueryScope = { reachesOut: /(^|[\s(])-?(repo|org|user|owner):/i, quoted: /"[^"]*"/g }

/** The `milestone:` qualifier reading a milestone's tickets. */
function milestoneQuery(title: string): string {
  return `milestone:"${title}"`
}

interface SearchResponse {
  total_count: number
  incomplete_results: boolean
  items: { node_id: string; state: 'open' | 'closed'; closed_at: string | null }[]
}

interface ErrorResponse {
  message?: string
  errors?: { message?: string }[]
}

/** GitHub answers a rate limit with a 429, or with a 403 that says so in its headers. */
function rateLimited({ status, headers }: Received): boolean {
  return status === 429 || (status === 403 && (headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after')))
}

/**
 * The failure an unsuccessful response stands for, other than a refused query. A rate limit still there after backoff
 * is unavailable; any other 403 refuses the token permission.
 */
function failureOf(received: Received): FailedCall {
  if (rateLimited(received)) return { ok: false, failure: 'unavailable' }
  if (received.status === 403) return { ok: false, failure: 'unauthorised' }
  return statusFailure(received.status)
}

/** `wait` is how backoff on a rate limit waits: a timer, unless a test stands in for it. */
export function githubConnector(
  connection: Extract<Connection, { tracker: 'github' }>,
  token: string,
  transport: Transport,
  wait: Wait = sleep,
): Connector {
  const repo = `${connection.owner}/${connection.repo}`

  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }

  /** The response, rate limits backed off, or `undefined` when the network failed. */
  function get(path: string): Promise<Received | undefined> {
    return send(transport, `${API}${path}`, { headers }, { rateLimited, wait })
  }

  return {
    milestoneChoices: async () => {
      const response = await get(`/repos/${repo}/milestones?state=open&per_page=${PAGE}`)
      if (!response) return { ok: false, failure: 'unavailable' }
      if (response.status !== 200) return failureOf(response)
      const milestones = response.body as { title: string }[]
      const choices: Choice[] = milestones.map(({ title }) => ({ kind: 'milestone', name: title, query: milestoneQuery(title) }))
      return { ok: true, choices }
    },

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const q = encodeURIComponent(`repo:${repo} is:issue (${query})`)
      const response = await get(`/search/issues?q=${q}&advanced_search=true&per_page=${PAGE}`)
      if (!response) return { ok: false, failure: 'unavailable' }
      if (response.status === 422) {
        const message = (response.body as ErrorResponse).errors?.[0]?.message ?? (response.body as ErrorResponse).message ?? ''
        // Search names an unknown or unseen repo this way, rather than with a 404.
        if (/cannot be searched/.test(message)) return { ok: false, failure: 'notFound' }
        return { ok: false, failure: 'invalidQuery', message }
      }
      if (response.status !== 200) return failureOf(response)
      const found = response.body as SearchResponse
      const tickets = finishedSince(
        found.items.map((item): Ticket => (item.state === 'closed' && item.closed_at ? { id: item.node_id, finishedAt: item.closed_at } : { id: item.node_id })),
        since,
      )
      return { ok: true, tickets, incomplete: found.incomplete_results || found.total_count > found.items.length }
    },
  }
}
