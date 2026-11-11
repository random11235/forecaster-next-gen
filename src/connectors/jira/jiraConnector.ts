import type { Connection } from '../../model/connection.js'
import type { Choice, Connector, FailedCall, ReadResult, Ticket, Transport } from '../connector.js'
import { failureOf, finishedSince, send, sleep, staysInScope, type Backoff, type QueryScope, type Received, type Wait } from '../remote.js'

/**
 * The Jira Cloud connector. A read is the project's open leaf tickets the query matches, plus those finished since
 * `finishedSince`, from every page of the enhanced JQL search. A leaf is a ticket at hierarchy level 0 with no
 * subtasks, or a subtask: epics are left out, and a story with subtasks gives way to its subtasks, which are read with
 * it, even when the story itself is finished too long ago for the search. A ticket is finished when its status is in
 * the Done category now, at its last move into Done, from its changelog: a status change from outside the Done
 * category into it. One made in Done, never moved there, finished when it was made. Resolution isn't read.
 *
 * It signs in as the connection's account email with the API token, sent as basic auth. Scoped API tokens work only
 * through Atlassian's gateway, by the site's cloud id, so the connector looks that up from the site first.
 * See docs/research/jira-connector.md (on research/jira-connector).
 */

const GATEWAY = 'https://api.atlassian.com/ex/jira'
const PAGE = 100
/** The most ids one search by id names, so its JQL stays short. */
const ID_BATCH = 100
/** The most tickets one changelog bulk fetch takes. */
const CHANGELOG_BATCH = 1000
/** What a read needs of each ticket besides its id. */
const FIELDS = ['issuetype', 'status', 'subtasks']
const DAY_MS = 24 * 60 * 60 * 1000

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

/**
 * A JQL date literal no later than `since`, a UTC instant, whatever time zone it is read in. JQL reads date literals in
 * the token user's time zone, which a read-only token can't look up; time zones run from 12 hours behind UTC to 14
 * ahead, so `since` less a day, written in UTC, is before `since` in every one of them.
 */
function jqlBefore(since: string): string {
  return new Date(Date.parse(since) - DAY_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** A Jira timestamp (`2026-03-01T10:00:00.000+1100`) as an instant `Date.parse` takes: its offset with a colon. */
function jiraInstant(timestamp: string): number {
  return Date.parse(timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
}

interface Version {
  id: string
  name: string
  released: boolean
  archived: boolean
}

interface Status {
  statusCategory: { key: string }
}

/** The project's statuses for one issue type, as its status list gives them. */
interface IssueTypeStatuses {
  statuses: (Status & { id: string })[]
}

/** A ticket as search returns it, with the fields asked for. */
interface Found<F> {
  id: string
  fields: F
}

/** What a read needs of each ticket its query finds. */
type ReadFields = { issuetype: { hierarchyLevel: number }; status: Status; subtasks?: { id: string; fields: { status: Status } }[] }

interface SearchResponse<F> {
  issues: Found<F>[]
  isLast?: boolean
  nextPageToken?: string
}

interface ChangelogResponse {
  /** Each ticket's status changes, `created` in milliseconds since the epoch, in no promised order. */
  issueChangeLogs: { issueId: string; changeHistories: { created: number; items: { fieldId?: string; from?: string | null; to?: string | null }[] }[] }[]
  nextPageToken?: string
}

interface ErrorResponse {
  errorMessages?: string[]
  errors?: Record<string, string>
}

const UNAVAILABLE: FailedCall = { ok: false, failure: 'unavailable' }

/** Jira answers a rate limit with a 429. */
function rateLimited({ status }: Received): boolean {
  return status === 429
}

function done(status: Status): boolean {
  return status.statusCategory.key === 'done'
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
  let doneStatuses: Set<string> | undefined

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

  /** The ids of the project's statuses in the Done category, looked up once. */
  async function doneStatusIds(): Promise<Set<string> | FailedCall> {
    if (doneStatuses === undefined) {
      const response = await api(`/project/${encodeURIComponent(key)}/statuses`)
      if ('ok' in response) return response
      if (response.status !== 200) return failureOf(response.status)
      const statuses = (response.body as IssueTypeStatuses[]).flatMap((issueType) => issueType.statuses)
      doneStatuses = new Set(statuses.filter(done).map((status) => status.id))
    }
    return doneStatuses
  }

  /**
   * Each ticket's last move into the Done category, in milliseconds since the epoch, from its changelog, fetched in
   * bulk: a status change from a status outside Done to one in it. A move between two Done statuses (Done to Won't Do)
   * isn't a finish. Bulk fetch promises no order, so the latest is found, not taken from the end.
   */
  async function lastStatusChanges(ids: string[]): Promise<Map<string, number> | FailedCall> {
    const last = new Map<string, number>()
    if (ids.length === 0) return last
    const doneIds = await doneStatusIds()
    if (!(doneIds instanceof Set)) return doneIds
    const intoDone = (item: { fieldId?: string; from?: string | null; to?: string | null }) =>
      item.fieldId === 'status' && doneIds.has(item.to ?? '') && !doneIds.has(item.from ?? '')
    for (let start = 0; start < ids.length; start += CHANGELOG_BATCH) {
      const issueIdsOrKeys = ids.slice(start, start + CHANGELOG_BATCH)
      let nextPageToken: string | undefined
      do {
        const response = await api('/changelog/bulkfetch', { issueIdsOrKeys, fieldIds: ['status'], ...(nextPageToken === undefined ? {} : { nextPageToken }) })
        if ('ok' in response) return response
        if (response.status !== 200) return failureOf(response.status)
        const page = response.body as ChangelogResponse
        for (const { issueId, changeHistories } of page.issueChangeLogs) {
          for (const { created, items } of changeHistories) {
            if (items.some(intoDone)) last.set(issueId, Math.max(last.get(issueId) ?? -Infinity, created))
          }
        }
        nextPageToken = page.nextPageToken
      } while (nextPageToken !== undefined)
    }
    return last
  }

  /** Every page of what search finds for `jql`, with `fields`; a JQL error, Jira's message with it, is invalidQuery. */
  async function search<F>(jql: string, fields: string[]): Promise<Found<F>[] | FailedCall> {
    const found: Found<F>[] = []
    let nextPageToken: string | undefined
    do {
      const response = await api('/search/jql', { jql, fields, maxResults: PAGE, ...(nextPageToken === undefined ? {} : { nextPageToken }) })
      if ('ok' in response) return response
      if (response.status === 400) {
        return { ok: false, failure: 'invalidQuery', message: (response.body as ErrorResponse).errorMessages?.join(' ') ?? '' }
      }
      if (response.status !== 200) return failureOf(response.status)
      const page = response.body as SearchResponse<F>
      found.push(...page.issues)
      nextPageToken = page.isLast === true ? undefined : page.nextPageToken
    } while (nextPageToken !== undefined)
    return found
  }

  /** What search finds among the tickets `ids`, a batch at a time, by `jql` naming them. */
  async function searchByIds<F>(ids: string[], jql: (idList: string) => string, fields: string[]): Promise<Found<F>[] | FailedCall> {
    const found: Found<F>[] = []
    for (let start = 0; start < ids.length; start += ID_BATCH) {
      const batch = await search<F>(jql(`id in (${ids.slice(start, start + ID_BATCH).join(', ')})`), fields)
      if (!Array.isArray(batch)) return batch
      found.push(...batch)
    }
    return found
  }

  /** When each of the tickets `ids` was made, as a UTC instant. */
  async function createdAt(ids: string[]): Promise<Map<string, string> | FailedCall> {
    const found = await searchByIds<{ created: string }>(ids, (idList) => `project = "${key}" AND ${idList}`, ['created'])
    if (!Array.isArray(found)) return found
    return new Map(found.map(({ id, fields }) => [id, new Date(jiraInstant(fields.created)).toISOString()]))
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
      const before = jqlBefore(since)
      const inWindow = `(statusCategory != Done OR status CHANGED AFTER "${before}" OR created >= "${before}")`
      const found = await search<ReadFields>(`project = "${key}" AND (${query}) AND ${inWindow}`, FIELDS)
      if (!Array.isArray(found)) return found
      if (found.length === 0) {
        // Search matches nothing, rather than failing, on a project that doesn't exist or can't be seen.
        const project = await api(`/project/${encodeURIComponent(key)}`)
        if ('ok' in project) return project
        if (project.status !== 200) return failureOf(project.status)
      }

      // A story the window leaves out (Done, unchanged since) can have a subtask open again, or finished since: its
      // subtasks still count. Its subtasks in the window name it; it is read if the query matches it.
      const subtasks = await search<{ parent?: { id: string } }>(`project = "${key}" AND issuetype in subTaskIssueTypes() AND ${inWindow}`, ['parent'])
      if (!Array.isArray(subtasks)) return subtasks
      const foundIds = new Set(found.map(({ id }) => id))
      const storiesLeftOut = [...new Set(subtasks.flatMap(({ fields }) => (fields.parent === undefined || foundIds.has(fields.parent.id) ? [] : [fields.parent.id])))]
      const stories = await searchByIds<ReadFields>(storiesLeftOut, (idList) => `project = "${key}" AND (${query}) AND ${idList}`, FIELDS)
      if (!Array.isArray(stories)) return stories
      found.push(...stories)

      // Each leaf's id, and whether it is finished. A subtask can be found both itself and under its story.
      const leaves = new Map<string, boolean>()
      for (const { id, fields } of found) {
        if (fields.issuetype.hierarchyLevel > 0) continue
        const subtasks = fields.subtasks ?? []
        if (subtasks.length === 0) leaves.set(id, done(fields.status))
        for (const subtask of subtasks) leaves.set(subtask.id, done(subtask.fields.status))
      }

      const lastChange = await lastStatusChanges([...leaves].filter(([, finished]) => finished).map(([id]) => id))
      if (!(lastChange instanceof Map)) return lastChange
      // In Done with no move into it, a ticket was made there: it finished when it was made.
      const made = await createdAt([...leaves].filter(([id, finished]) => finished && !lastChange.has(id)).map(([id]) => id))
      if (!(made instanceof Map)) return made
      const tickets: Ticket[] = []
      for (const [id, finished] of leaves) {
        const at = lastChange.get(id)
        if (!finished) tickets.push({ id })
        else if (at !== undefined) tickets.push({ id, finishedAt: new Date(at).toISOString() })
        else {
          const madeAt = made.get(id)
          if (madeAt !== undefined) tickets.push({ id, finishedAt: madeAt })
        }
      }
      // The JQL's lower bound is a day early; this keeps the window exact.
      return { ok: true, tickets: finishedSince(tickets, since), incomplete: false }
    },
  }
}
