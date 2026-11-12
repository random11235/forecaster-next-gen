import type { Connection } from '../../model/connection.js'
import {
  CHOICES_LIMIT,
  type Choice,
  type ChoicesOfKind,
  type Connector,
  type FailedCall,
  type ReadResult,
  type SearchedChoices,
  type Ticket,
  type Transport,
} from '../connector.js'
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
 *
 * A picked epic (`parent = KEY-N`, as its choice reads it) stands for every leaf beneath it. Beneath an epic are stories
 * and their subtasks, which the read reaches already; in a hierarchy with levels above epics, a ticket picked there has
 * epics beneath it, found level by level through `parent` before each read, and the ticket is read as itself or any of
 * them. The query keeps only the pick, so one added beneath it since is found on the next read.
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

/**
 * Each picked epic a query names, as its choice reads it: `parent = KEY-N`, not negated by a `NOT` before it and not in
 * quotes. A quoted value is matched too, with no key, so a term inside quotes is kept as written.
 */
const PICKED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?<!\bnot\s+)(?<=^|[\s(])parent\s*=\s*([a-z][a-z0-9_]*-\d+)(?=$|[\s)])/gi

/** The characters JQL's text search (`~`) reads as its own syntax, and quotes. */
const TEXT_SEARCH_SPECIALS = /[+\-&|!(){}[\]^"'~*?:\\/]/g

/** `value` as a JQL string: in double quotes, any quote or backslash in it escaped. */
function jqlString(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
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
  /** Changes when the ticket moves project, so only an epic's choice is read by it, for the EM to recognise. */
  key: string
  fields: F
}

/** What finding the tickets beneath a picked epic needs of each. */
type LevelFields = { issuetype: { hierarchyLevel: number }; parent?: { id: string } }

/** What a read needs of each ticket its query finds. */
type ReadFields = { issuetype: { hierarchyLevel: number }; status: Status; subtasks?: { id: string; fields: { status: Status } }[] }

interface SearchResponse<F> {
  issues: Found<F>[]
  isLast?: boolean
  nextPageToken?: string
}

/** One field's change in a changelog: for a status, the ids of the statuses it moved from and to. */
interface ChangeItem {
  fieldId?: string
  from?: string | null
  to?: string | null
}

interface ChangelogResponse {
  /** Each ticket's status changes, `created` in milliseconds since the epoch, in no promised order. */
  issueChangeLogs: { issueId: string; changeHistories: { created: number; items: ChangeItem[] }[] }[]
  nextPageToken?: string
}

/** A page of the site's labels. */
interface LabelsResponse {
  values: string[]
  isLast?: boolean
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

/** One page of a call Jira pages by cursor: its items, and the cursor to the next page, if there is one. */
interface Page<T> {
  items: T[]
  nextPageToken: string | undefined
}

/** Every page's items, each page asked for by the cursor the last gave; or the failure that stopped one. */
async function everyPage<T>(pageAt: (nextPageToken: string | undefined) => Promise<Page<T> | FailedCall>): Promise<T[] | FailedCall> {
  const items: T[] = []
  let nextPageToken: string | undefined
  do {
    const page = await pageAt(nextPageToken)
    if ('ok' in page) return page
    items.push(...page.items)
    nextPageToken = page.nextPageToken
  } while (nextPageToken !== undefined)
  return items
}

/** A request body's cursor field, for every page but the first. */
function cursor(nextPageToken: string | undefined): { nextPageToken?: string } {
  return nextPageToken === undefined ? {} : { nextPageToken }
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
   * Each ticket's last move into the Done category, as a UTC instant, from its changelog, fetched in bulk: a status
   * change from a status outside Done to one in it. A move between two Done statuses (Done to Won't Do) isn't a
   * finish. Bulk fetch promises no order, so the latest is found, not taken from the end.
   */
  async function lastMovesIntoDone(ids: string[]): Promise<Map<string, string> | FailedCall> {
    if (ids.length === 0) return new Map()
    const doneIds = await doneStatusIds()
    if (!(doneIds instanceof Set)) return doneIds
    const intoDone = (item: ChangeItem) => item.fieldId === 'status' && doneIds.has(item.to ?? '') && !doneIds.has(item.from ?? '')
    /** In milliseconds since the epoch, as bulk fetch gives them. */
    const lastMs = new Map<string, number>()
    for (let start = 0; start < ids.length; start += CHANGELOG_BATCH) {
      const issueIdsOrKeys = ids.slice(start, start + CHANGELOG_BATCH)
      const changelogs = await everyPage(async (nextPageToken) => {
        const response = await api('/changelog/bulkfetch', { issueIdsOrKeys, fieldIds: ['status'], ...cursor(nextPageToken) })
        if ('ok' in response) return response
        if (response.status !== 200) return failureOf(response.status)
        const page = response.body as ChangelogResponse
        return { items: page.issueChangeLogs, nextPageToken: page.nextPageToken }
      })
      if (!Array.isArray(changelogs)) return changelogs
      for (const { issueId, changeHistories } of changelogs) {
        for (const { created, items } of changeHistories) {
          if (items.some(intoDone)) lastMs.set(issueId, Math.max(lastMs.get(issueId) ?? -Infinity, created))
        }
      }
    }
    return new Map([...lastMs].map(([id, ms]) => [id, new Date(ms).toISOString()]))
  }

  /** Every page of what search finds for `jql`, with `fields`; a JQL error, Jira's message with it, is invalidQuery. */
  function search<F>(jql: string, fields: string[]): Promise<Found<F>[] | FailedCall> {
    return everyPage(async (nextPageToken) => {
      const response = await api('/search/jql', { jql, fields, maxResults: PAGE, ...cursor(nextPageToken) })
      if ('ok' in response) return response
      if (response.status === 400) {
        return { ok: false, failure: 'invalidQuery', message: (response.body as ErrorResponse).errorMessages?.join(' ') ?? '' }
      }
      if (response.status !== 200) return failureOf(response.status)
      const page = response.body as SearchResponse<F>
      return { items: page.issues, nextPageToken: page.isLast === true ? undefined : page.nextPageToken }
    })
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

  /**
   * `query` with each picked epic it names read as itself or any ticket above level 0 beneath it, found level by level
   * through `parent`: the picked tickets first, by key, then each level's children, while any is above level 1.
   */
  async function expanded(query: string): Promise<string | FailedCall> {
    const keys = [...new Set([...query.matchAll(PICKED)].flatMap((match) => (match[1] === undefined ? [] : [match[1].toUpperCase()])))]
    if (keys.length === 0) return query
    const picked = await search<LevelFields>(`project = "${key}" AND key in (${keys.join(', ')})`, ['issuetype'])
    if (!Array.isArray(picked)) return picked
    /** The picked epic each ticket found is beneath, by the ticket's id (a picked epic beneath itself). */
    const pickedAbove = new Map(picked.map((ticket) => [ticket.id, ticket.key.toUpperCase()]))
    const beneath = new Map<string, string[]>()
    // A level's children are a level below it, so the levels run out at the hierarchy's foot.
    let level = picked.filter(({ fields }) => fields.issuetype.hierarchyLevel > 1)
    while (level.length > 0) {
      const children = await search<LevelFields>(`project = "${key}" AND parent in (${level.map(({ id }) => id).join(', ')})`, ['issuetype', 'parent'])
      if (!Array.isArray(children)) return children
      level = []
      for (const child of children) {
        const above = child.fields.parent === undefined ? undefined : pickedAbove.get(child.fields.parent.id)
        if (above === undefined || pickedAbove.has(child.id) || child.fields.issuetype.hierarchyLevel < 1) continue
        pickedAbove.set(child.id, above)
        beneath.set(above, [...(beneath.get(above) ?? []), child.id])
        level.push(child)
      }
      level = level.filter(({ fields }) => fields.issuetype.hierarchyLevel > 1)
    }
    return query.replace(PICKED, (term, epic: string | undefined) => {
      const found = epic === undefined ? undefined : beneath.get(epic.toUpperCase())
      return found === undefined ? term : `parent in (${[epic, ...found].join(', ')})`
    })
  }

  /** Every one of the project's unreleased fix versions, each read by its name: Jira gives them all at once. */
  async function unreleasedVersions(): Promise<Choice[] | FailedCall> {
    const response = await api(`/project/${encodeURIComponent(key)}/versions`)
    if ('ok' in response) return response
    if (response.status !== 200) return failureOf(response.status)
    return (response.body as Version[])
      .filter((version) => !version.released && !version.archived)
      .map((version) => ({ kind: 'fixVersion', name: version.name, query: `fixVersion = ${jqlString(version.name)}` }))
  }

  /** The project's unreleased fix versions; past the limit, the first are listed. */
  async function fixVersions(): Promise<ChoicesOfKind | FailedCall> {
    const choices = await unreleasedVersions()
    if (!Array.isArray(choices)) return choices
    return { kind: 'fixVersion', choices: choices.slice(0, CHOICES_LIMIT), pastLimit: choices.length > CHOICES_LIMIT }
  }

  /** The unreleased fix versions with `text` in their names, ignoring case, up to the limit: matched here, as Jira gives them all. */
  async function searchedVersions(text: string): Promise<SearchedChoices> {
    const choices = await unreleasedVersions()
    if (!Array.isArray(choices)) return choices
    const typed = text.toLowerCase()
    return { ok: true, choices: choices.filter((choice) => choice.name.toLowerCase().includes(typed)).slice(0, CHOICES_LIMIT) }
  }

  /**
   * The first page of the project's epics not yet done, and matching `clause` too, if any; newest first, each named by
   * its summary and read by its children.
   */
  async function epicsPage(clause = ''): Promise<{ choices: Choice[]; isLast: boolean } | FailedCall> {
    const jql = `project = "${key}" AND issuetype = Epic AND statusCategory != Done${clause} ORDER BY created DESC`
    const response = await api('/search/jql', { jql, fields: ['summary'], maxResults: CHOICES_LIMIT })
    if ('ok' in response) return response
    if (response.status !== 200) return failureOf(response.status)
    const page = response.body as SearchResponse<{ summary: string }>
    const choices: Choice[] = page.issues.map((epic) => ({ kind: 'epic', name: epic.fields.summary, query: `parent = ${epic.key}` }))
    return { choices, isLast: page.isLast === true }
  }

  /** The project's epics not yet done, up to the limit. */
  async function epics(): Promise<ChoicesOfKind | FailedCall> {
    const page = await epicsPage()
    if ('ok' in page) return page
    return { kind: 'epic', choices: page.choices, pastLimit: !page.isLast }
  }

  /**
   * The epics not done with a word starting with each word of `text` in their summaries, up to the limit. Text
   * search's special characters are left out, so none can make the JQL fail.
   */
  async function searchedEpics(text: string): Promise<SearchedChoices> {
    const words = text.replace(TEXT_SEARCH_SPECIALS, ' ').split(/\s+/).filter((word) => word !== '')
    const page = await epicsPage(words.map((word) => ` AND summary ~ "${word}*"`).join(''))
    if ('ok' in page) return page
    return { ok: true, choices: page.choices }
  }

  /** The site's labels JQL suggests for `text`, as it autocompletes the labels field, up to the limit. */
  async function searchedLabels(text: string): Promise<SearchedChoices> {
    const response = await api(`/jql/autocompletedata/suggestions?fieldName=labels&fieldValue=${encodeURIComponent(text)}`)
    if ('ok' in response) return response
    if (response.status !== 200) return failureOf(response.status)
    const { results } = response.body as { results: { value: string }[] }
    const choices: Choice[] = results.map(({ value }) => ({ kind: 'label', name: value, query: `labels = ${jqlString(value)}` }))
    return { ok: true, choices: choices.slice(0, CHOICES_LIMIT) }
  }

  const SEARCHES: Readonly<Record<string, (text: string) => Promise<SearchedChoices>>> = {
    fixVersion: searchedVersions,
    epic: searchedEpics,
    label: searchedLabels,
  }

  /** The site's labels: Jira keeps labels for the whole site, not per project. */
  async function labels(): Promise<ChoicesOfKind | FailedCall> {
    const response = await api(`/label?maxResults=${CHOICES_LIMIT}`)
    if ('ok' in response) return response
    if (response.status !== 200) return failureOf(response.status)
    const page = response.body as LabelsResponse
    const choices: Choice[] = page.values.map((label) => ({ kind: 'label', name: label, query: `labels = ${jqlString(label)}` }))
    return { kind: 'label', choices, pastLimit: page.isLast !== true }
  }

  return {
    searchChoices: async (kind, text) => {
      const search = Object.hasOwn(SEARCHES, kind) ? SEARCHES[kind]! : undefined
      return search ? search(text) : { ok: true, choices: [] }
    },

    milestoneChoices: async () => {
      const kinds: ChoicesOfKind[] = []
      for (const list of [fixVersions, epics, labels]) {
        const listed = await list()
        if ('ok' in listed) return listed
        kinds.push(listed)
      }
      return { ok: true, kinds }
    },

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const withEpicsBeneath = await expanded(query)
      if (typeof withEpicsBeneath !== 'string') return withEpicsBeneath
      const before = jqlBefore(since)
      const inWindow = `(statusCategory != Done OR status CHANGED AFTER "${before}" OR created >= "${before}")`
      const matched = await search<ReadFields>(`project = "${key}" AND (${withEpicsBeneath}) AND ${inWindow}`, FIELDS)
      if (!Array.isArray(matched)) return matched
      if (matched.length === 0) {
        // Search matches nothing, rather than failing, on a project that doesn't exist or can't be seen.
        const project = await api(`/project/${encodeURIComponent(key)}`)
        if ('ok' in project) return project
        if (project.status !== 200) return failureOf(project.status)
      }

      // A story the window leaves out (Done, unchanged since) can have a subtask open again, or finished since: its
      // subtasks still count. Its subtasks in the window name it; it is read if the query matches it.
      const subtasks = await search<{ parent?: { id: string } }>(`project = "${key}" AND issuetype in subTaskIssueTypes() AND ${inWindow}`, ['parent'])
      if (!Array.isArray(subtasks)) return subtasks
      const matchedIds = new Set(matched.map(({ id }) => id))
      const storiesLeftOut = [...new Set(subtasks.flatMap(({ fields }) => (fields.parent === undefined || matchedIds.has(fields.parent.id) ? [] : [fields.parent.id])))]
      const stories = await searchByIds<ReadFields>(storiesLeftOut, (idList) => `project = "${key}" AND (${withEpicsBeneath}) AND ${idList}`, FIELDS)
      if (!Array.isArray(stories)) return stories
      matched.push(...stories)

      // Whether each leaf is finished, by its id. A subtask can be matched both itself and under its story.
      const isFinished = new Map<string, boolean>()
      for (const { id, fields } of matched) {
        if (fields.issuetype.hierarchyLevel > 0) continue
        const subtasks = fields.subtasks ?? []
        if (subtasks.length === 0) isFinished.set(id, done(fields.status))
        for (const subtask of subtasks) isFinished.set(subtask.id, done(subtask.fields.status))
      }
      const finishedIds = [...isFinished].filter(([, finished]) => finished).map(([id]) => id)

      const movedIntoDone = await lastMovesIntoDone(finishedIds)
      if (!(movedIntoDone instanceof Map)) return movedIntoDone
      // In Done with no move into it, a ticket was made there: it finished when it was made.
      const madeAt = await createdAt(finishedIds.filter((id) => !movedIntoDone.has(id)))
      if (!(madeAt instanceof Map)) return madeAt
      const tickets: Ticket[] = []
      for (const [id, finished] of isFinished) {
        const finishedAt = finished ? (movedIntoDone.get(id) ?? madeAt.get(id)) : undefined
        if (!finished) tickets.push({ id })
        else if (finishedAt !== undefined) tickets.push({ id, finishedAt })
      }
      // The JQL's lower bound is a day early; this keeps the window exact.
      return { ok: true, tickets: finishedSince(tickets, since), incomplete: false }
    },
  }
}
