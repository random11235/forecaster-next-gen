import type { Choice, Connection, Connector, Failed, ReadResult, Ticket, Transport } from '../connector.js'

/**
 * The GitHub connector, so far a skeleton that passes the contract suite's shape cases (#172). It reads through
 * GitHub's REST API: issue search, rather than GraphQL's, because only REST refuses a query it can't parse, with its own
 * message, where GraphQL silently matches nothing. Its full reads (leaf tickets, last finish, paging) come with the spec
 * on which tickets count; until then a read is one page of search results, flagged incomplete when there are more.
 */

const API = 'https://api.github.com'
const PAGE = 100

/** Search qualifiers that name where to look: a query using one would reach past the connection's repo. */
const SCOPE_QUALIFIERS = /(^|[\s(])-?(repo|org|user|owner):/i

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

/**
 * True when the query stays inside the parentheses the connector wraps it in, so `repo:` and `is:issue` hold for all
 * of it: no qualifier naming another repo, and no `)` closing the wrapper.
 */
function staysInScope(query: string): boolean {
  if (SCOPE_QUALIFIERS.test(query)) return false
  let depth = 0
  for (const char of query) {
    if (char === '(') depth++
    if (char === ')' && --depth < 0) return false
  }
  return true
}

/** The failure an unsuccessful response stands for, other than a refused query. */
function failureOf(status: number): Failed {
  if (status === 401) return { ok: false, failure: 'unauthorised' }
  if (status === 404) return { ok: false, failure: 'notFound' }
  return { ok: false, failure: 'unavailable' }
}

export function githubConnector(connection: Extract<Connection, { tracker: 'github' }>, token: string, transport: Transport): Connector {
  const repo = `${connection.owner}/${connection.repo}`

  /** The response's status and JSON body, or `undefined` when the network failed. */
  async function get(path: string): Promise<{ status: number; body: unknown } | undefined> {
    try {
      const response = await transport(`${API}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      })
      return { status: response.status, body: await response.json() }
    } catch {
      return undefined
    }
  }

  return {
    milestoneChoices: async () => {
      const response = await get(`/repos/${repo}/milestones?state=open&per_page=${PAGE}`)
      if (!response) return { ok: false, failure: 'unavailable' }
      if (response.status !== 200) return failureOf(response.status)
      const milestones = response.body as { title: string }[]
      const choices: Choice[] = milestones.map(({ title }) => ({ kind: 'milestone', name: title, query: milestoneQuery(title) }))
      return { ok: true, choices }
    },

    read: async (query, finishedSince): Promise<ReadResult> => {
      if (!staysInScope(query)) return { ok: false, failure: 'outOfScope' }
      const q = encodeURIComponent(`repo:${repo} is:issue (${query})`)
      const response = await get(`/search/issues?q=${q}&advanced_search=true&per_page=${PAGE}`)
      if (!response) return { ok: false, failure: 'unavailable' }
      if (response.status === 422) {
        const message = (response.body as ErrorResponse).errors?.[0]?.message ?? (response.body as ErrorResponse).message ?? ''
        // Search names an unknown or unseen repo this way, rather than with a 404.
        if (/cannot be searched/.test(message)) return { ok: false, failure: 'notFound' }
        return { ok: false, failure: 'invalidQuery', message }
      }
      if (response.status !== 200) return failureOf(response.status)
      const found = response.body as SearchResponse
      const since = Date.parse(finishedSince)
      const tickets = found.items
        .map((item): Ticket => (item.state === 'closed' && item.closed_at ? { id: item.node_id, finishedAt: item.closed_at } : { id: item.node_id }))
        .filter((ticket) => ticket.finishedAt === undefined || Date.parse(ticket.finishedAt) >= since)
      return { ok: true, tickets, incomplete: found.incomplete_results || found.total_count > found.items.length }
    },
  }
}
