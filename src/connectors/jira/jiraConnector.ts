import type { Choice, Connection, Connector, Failed, ReadResult, Ticket, Transport } from '../connector.js'

/**
 * The Jira Cloud connector, so far a skeleton that passes the contract suite's shape cases (#173). Its full reads (leaf
 * tickets, last finish from the changelog, paging) come with the spec on which tickets count; until then a read is one
 * page of JQL search results, flagged incomplete when there are more, and a finished ticket's finish is when its status
 * last entered the Done category.
 *
 * Its token is `email:apiToken`, sent as basic auth. Scoped API tokens work only through Atlassian's gateway, by the
 * site's cloud id, so the connector looks that up from the site first.
 * See docs/research/jira-connector.md (on research/jira-connector).
 */

const GATEWAY = 'https://api.atlassian.com/ex/jira'
const PAGE = 100

/** A JQL clause naming the `project` field: a query using one would reach past the connection's project. */
const PROJECT_CLAUSE = /(^|[\s(])project\s*(!?=|~|\bnot\s+in\b|\bin\b|\bis\b|\bwas\b|\bchanged\b)/i

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

/** True when the query names no project and stays inside the parentheses the connector wraps it in. */
function staysInScope(query: string): boolean {
  if (PROJECT_CLAUSE.test(query)) return false
  let depth = 0
  for (const char of query) {
    if (char === '(') depth++
    if (char === ')' && --depth < 0) return false
  }
  return true
}

/** Jira's timestamp, which carries the token user's offset (`+1100`), as a UTC instant. */
function utc(timestamp: string): string {
  return new Date(timestamp.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).toISOString()
}

/** The failure an unsuccessful response stands for, other than a refused query. */
function failureOf(status: number): Failed {
  if (status === 401) return { ok: false, failure: 'unauthorised' }
  if (status === 404) return { ok: false, failure: 'notFound' }
  return { ok: false, failure: 'unavailable' }
}

type Reply = { status: number; body: unknown }

export function jiraConnector(connection: Extract<Connection, { tracker: 'jira' }>, token: string, transport: Transport): Connector {
  const key = connection.projectKey
  const authorization = `Basic ${btoa(token)}`

  /** The response's status and body (JSON where it is JSON), or `undefined` when the network failed. */
  async function call(url: string, init: RequestInit): Promise<Reply | undefined> {
    try {
      const response = await transport(url, init)
      const text = await response.text()
      let body: unknown = text
      try {
        body = JSON.parse(text)
      } catch {}
      return { status: response.status, body }
    } catch {
      return undefined
    }
  }

  let cloudId: string | undefined

  /** A call to the site's REST API through the gateway, or the failure that stopped it reaching there. */
  async function api(path: string, body?: unknown): Promise<Reply | Failed> {
    if (cloudId === undefined) {
      const tenant = await call(`https://${connection.site}/_edge/tenant_info`, {})
      if (!tenant) return { ok: false, failure: 'unavailable' }
      if (tenant.status !== 200) return failureOf(tenant.status)
      cloudId = (tenant.body as { cloudId: string }).cloudId
    }
    const headers: Record<string, string> = { authorization, accept: 'application/json' }
    const init: RequestInit =
      body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
    return (await call(`${GATEWAY}/${cloudId}/rest/api/3${path}`, init)) ?? { ok: false, failure: 'unavailable' }
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

    read: async (query, finishedSince): Promise<ReadResult> => {
      if (!staysInScope(query)) return { ok: false, failure: 'outOfScope' }
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
      const since = Date.parse(finishedSince)
      const tickets = found.issues
        .map(({ id, fields }): Ticket =>
          fields.status.statusCategory.key === 'done' && fields.statuscategorychangedate
            ? { id, finishedAt: utc(fields.statuscategorychangedate) }
            : { id },
        )
        .filter((ticket) => ticket.finishedAt === undefined || Date.parse(ticket.finishedAt) >= since)
      return { ok: true, tickets, incomplete: found.isLast === false || found.nextPageToken !== undefined }
    },
  }
}
