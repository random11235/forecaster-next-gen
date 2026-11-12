import type { Connection } from '../../model/connection.js'
import { CHOICES_LIMIT, type Choice, type Connector, type FailedCall, type ReadResult, type Ticket, type Transport } from '../connector.js'
import { failureOf as statusFailure, finishedSince, send, sleep, staysInScope, type Backoff, type QueryScope, type Received, type Wait } from '../remote.js'

/**
 * The GitHub connector. It reads through GitHub's REST API: issue search, rather than GraphQL's, because only REST
 * refuses a query it can't parse, with its own message, where GraphQL silently matches nothing (#156).
 *
 * A read is the repo's open leaf issues the query matches, plus those closed since `finishedSince`, each finished at
 * its last close (`closed_at`); the project board isn't read. `is:issue` leaves out pull requests and `no:sub-issue`
 * parents. Every page is read, up to the 1,000 results search gives, past which the read is incomplete.
 */

const API = 'https://api.github.com'
const PAGE = 100
/** The most results search gives for one query, however many it finds. */
const SEARCH_CAP = 1000

/**
 * Search wraps the query as `repo:… is:issue no:sub-issue (query) (…)`; a qualifier naming where to look would reach past the repo.
 * Search quotes values in double quotes only, with no escapes.
 */
const SCOPE: QueryScope = { reachesOut: /(^|[\s(])-?(repo|org|user|owner):/i, quoted: /"[^"]*"/g }

/** `since`, a UTC instant, as search's date qualifiers take it, to the second: the window's lower bound, inclusive. */
function searchDate(since: string): string {
  return `${new Date(since).toISOString().slice(0, 19)}+00:00`
}

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
  const backoff: Backoff = { rateLimited, wait }

  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }

  /** The response, rate limits backed off, or `undefined` when the network failed. */
  function get(path: string): Promise<Received | undefined> {
    return send(transport, `${API}${path}`, { headers }, backoff)
  }

  return {
    milestoneChoices: async () => {
      const response = await get(`/repos/${repo}/milestones?state=open&per_page=${CHOICES_LIMIT}`)
      if (!response) return { ok: false, failure: 'unavailable' }
      if (response.status !== 200) return failureOf(response)
      const milestones = response.body as { title: string }[]
      const choices: Choice[] = milestones.map(({ title }) => ({ kind: 'milestone', name: title, query: milestoneQuery(title) }))
      let pastLimit = false
      if (milestones.length === CHOICES_LIMIT) {
        // A full page may be all of them: whether there is one more is asked only then, as one milestone past the limit.
        const next = await get(`/repos/${repo}/milestones?state=open&per_page=1&page=${CHOICES_LIMIT + 1}`)
        if (!next) return { ok: false, failure: 'unavailable' }
        if (next.status !== 200) return failureOf(next)
        pastLimit = (next.body as unknown[]).length > 0
      }
      return { ok: true, kinds: [{ kind: 'milestone', choices, pastLimit }] }
    },

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const q = encodeURIComponent(`repo:${repo} is:issue no:sub-issue (${query}) (is:open OR closed:>=${searchDate(since)})`)
      const tickets: Ticket[] = []
      let incomplete = false
      for (let page = 1; ; page++) {
        const response = await get(`/search/issues?q=${q}&advanced_search=true&per_page=${PAGE}&page=${page}`)
        if (!response) return { ok: false, failure: 'unavailable' }
        if (response.status === 422) {
          const message = (response.body as ErrorResponse).errors?.[0]?.message ?? (response.body as ErrorResponse).message ?? ''
          // Search names an unknown or unseen repo this way, rather than with a 404.
          if (/cannot be searched/.test(message)) return { ok: false, failure: 'notFound' }
          return { ok: false, failure: 'invalidQuery', message }
        }
        if (response.status !== 200) return failureOf(response)
        const results = response.body as SearchResponse
        for (const item of results.items) {
          tickets.push(item.state === 'closed' && item.closed_at ? { id: item.node_id, finishedAt: item.closed_at } : { id: item.node_id })
        }
        incomplete ||= results.incomplete_results
        const read = (page - 1) * PAGE + results.items.length
        if (results.items.length < PAGE || read >= results.total_count) break
        if (read >= SEARCH_CAP) {
          incomplete = true
          break
        }
      }
      // Search compares to the second; this keeps the window exact.
      return { ok: true, tickets: finishedSince(tickets, since), incomplete }
    },
  }
}
