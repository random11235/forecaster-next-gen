import type { Connection } from '../../model/connection.js'
import type { Choice, Connector, FailedCall, ReadResult, Ticket, Transport } from '../connector.js'
import { failureOf, finishedSince, send, sleep, staysInScope, type Backoff, type QueryScope, type Received, type Wait } from '../remote.js'

/**
 * The Jira Cloud connector, so far a skeleton that passes the contract suite's shape cases (#173). Its full reads (leaf
 * tickets, last finish from the changelog, paging) come with the spec on which tickets count;
 * until then a read is one page of JQL search results, flagged incomplete when there are more, and a finished ticket's
 * finish is when its status last entered the Done category.
 *
 * It signs in as the connection's account email with the API token, sent as basic auth. Scoped API tokens work only through Atlassian's gateway, by the
 * site's cloud id, so the connector looks that up from the site first.
 * See docs/research/jira-connector.md (on research/jira-connector).
 */

const GATEWAY = 'https://api.atlassian.com/ex/jira'
const PAGE = 100

/**
 * A read's JQL is wrapped as `project = "KEY" AND (query)`; a clause naming a project would reach past it. JQL quotes
 * values in double or single quotes, escaping a quote inside with a backslash.
 */
const SCOPE: QueryScope = {
  reachesOut: /(^|[\s(])project\s*(!?=|~|\bnot\s+in\b|\bin\b|\bis\b|\bwas\b|\bchanged\b)/i,
  quoted: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
}

/** The JQL reading a fix version's tickets, by its id, which survives a rename. */
function fixVersionQuery(id: string): string {
  return `fixVersion = ${id}`
}

interface Version {
  id: string
  name: string
  released: boolean
  archived: boolean
}

interface SearchResponse {
  issues: { id: string; fields: { status: { statusCategory: { key: string } }; statuscategorychangedate?: string } }[]
  isLast?: boolean
  nextPageToken?: string
}

interface ErrorResponse {
  errorMessages?: string[]
  errors?: Record<string, string>
}

/** Jira's timestamp, which carries the token user's offset (`+1100`), as a UTC instant. */
function utc(timestamp: string): string {
  return new Date(timestamp.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).toISOString()
}

const UNAVAILABLE: FailedCall = { ok: false, failure: 'unavailable' }

/** Jira answers a rate limit with a 429. */
function rateLimited({ status }: Received): boolean {
  return status === 429
}

/** `wait` is how backoff on a rate limit waits: a timer, unless a test stands in for it. */
export function jiraConnector(
  connection: Extract<Connection, { tracker: 'jira' }>,
  token: string,
  transport: Transport,
  wait: Wait = sleep,
): Connector {
  const key = connection.projectKey
  const backoff: Backoff = { rateLimited, wait }
  const authorization = `Basic ${btoa(`${connection.email}:${token}`)}`

  let cloudId: string | undefined

  /** A call to the site's REST API through the gateway, or the failure that stopped it reaching there. */
  async function api(path: string, body?: unknown): Promise<Received | FailedCall> {
    if (cloudId === undefined) {
      const tenant = await send(transport, `https://${connection.site}/_edge/tenant_info`, {}, backoff)
      if (!tenant) return UNAVAILABLE
      if (tenant.status !== 200) return failureOf(tenant.status)
      cloudId = (tenant.body as { cloudId: string }).cloudId
    }
    const headers: Record<string, string> = { authorization, accept: 'application/json' }
    const init: RequestInit =
      body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
    return (await send(transport, `${GATEWAY}/${cloudId}/rest/api/3${path}`, init, backoff)) ?? UNAVAILABLE
  }

  return {
    milestoneChoices: async () => {
      const response = await api(`/project/${encodeURIComponent(key)}/versions`)
      if ('ok' in response) return response
      if (response.status !== 200) return failureOf(response.status)
      const choices: Choice[] = (response.body as Version[])
        .filter((version) => !version.released && !version.archived)
        .map((version) => ({ kind: 'fixVersion', name: version.name, query: fixVersionQuery(version.id) }))
      return { ok: true, choices }
    },

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const jql = `project = "${key}" AND (${query})`
      const response = await api('/search/jql', { jql, fields: ['status', 'statuscategorychangedate'], maxResults: PAGE })
      if ('ok' in response) return response
      if (response.status === 400) {
        return { ok: false, failure: 'invalidQuery', message: (response.body as ErrorResponse).errorMessages?.join(' ') ?? '' }
      }
      if (response.status !== 200) return failureOf(response.status)
      const found = response.body as SearchResponse
      if (found.issues.length === 0) {
        // Search matches nothing, rather than failing, on a project that doesn't exist or can't be seen.
        const project = await api(`/project/${encodeURIComponent(key)}`)
        if ('ok' in project) return project
        if (project.status !== 200) return failureOf(project.status)
      }
      const tickets = finishedSince(
        found.issues.map(({ id, fields }): Ticket =>
          fields.status.statusCategory.key === 'done' && fields.statuscategorychangedate
            ? { id, finishedAt: utc(fields.statuscategorychangedate) }
            : { id },
        ),
        since,
      )
      return { ok: true, tickets, incomplete: found.isLast === false || found.nextPageToken !== undefined }
    },
  }
}
