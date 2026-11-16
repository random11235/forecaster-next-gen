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
import { DAY_MS } from '../../model/time.js'
import {
  answered,
  failureOf,
  finishedSince,
  got,
  milestoneChoicesOf,
  pickedEpicsIn,
  pickedEpicsPattern,
  searchChoicesIn,
  searchedIn,
  send,
  sleep,
  staysInScope,
  UNAVAILABLE,
  withPickedEpics,
  type Backoff,
  type ChoiceSearches,
  type Expanded,
  type Got,
  type PickedEpics,
  type QueryScope,
  type Received,
  type Wait,
} from '../remote.js'

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
const PICKED: PickedEpics = pickedEpicsPattern(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?<!\bnot\s+)(?<=^|[\s(])parent\s*=\s*([a-z][a-z0-9_]*-\d+)(?=$|[\s)])/i)

/** The characters JQL's text search (`~`) reads as its own syntax, and quotes. */
const TEXT_SEARCH_SPECIALS = /[+\-&|!(){}[\]^"'~*?:\\/]/g

/** `value` as a JQL string: in double quotes, any quote or backslash in it escaped. */
function jqlString(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
}

// Each kind's choice is built here and nowhere else, so a choice listed and the same one searched for read alike.

/** A fix version's choice, read by its name. */
function fixVersionChoice(name: string): Choice {
  return { kind: 'fixVersion', name, query: `fixVersion = ${jqlString(name)}` }
}

/** An epic's choice: named by its summary, and read by its children. */
function epicChoice(epic: Found<{ summary: string }>): Choice {
  return { kind: 'epic', name: epic.fields.summary, query: `parent = ${epic.key}` }
}

/** A label's choice. */
function labelChoice(label: string): Choice {
  return { kind: 'label', name: label, query: `labels = ${jqlString(label)}` }
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
async function everyPage<T>(pageAt: (nextPageToken: string | undefined) => Promise<Got<Page<T>>>): Promise<Got<T[]>> {
  const items: T[] = []
  let nextPageToken: string | undefined
  do {
    const page = await pageAt(nextPageToken)
    if (!page.ok) return page
    items.push(...page.value.items)
    nextPageToken = page.value.nextPageToken
  } while (nextPageToken !== undefined)
  return got(items)
}

/** The failure an unsuccessful search stands for: a JQL error, Jira's message with it, is invalidQuery. */
function searchFailure(received: Received): FailedCall {
  if (received.status !== 400) return failureOf(received)
  return { ok: false, failure: 'invalidQuery', message: (received.body as ErrorResponse).errorMessages?.join(' ') ?? '' }
}

/** A request body's cursor field, for every page but the first. */
function cursor(nextPageToken: string | undefined): { nextPageToken?: string } {
  return nextPageToken === undefined ? {} : { nextPageToken }
}

/** `wait` is how backoff on a rate limit waits: a timer, unless a test stands in for it. */
export function jiraConnector(connection: Extract<Connection, { tracker: 'jira' }>, token: string, transport: Transport, wait: Wait = sleep): Connector {
  const key = connection.projectKey
  const backoff: Backoff = { rateLimited, wait }
  const authorization = `Basic ${btoa(`${connection.email}:${token}`)}`

  let cloudId: string | undefined
  let doneStatuses: Set<string> | undefined

  /**
   * What the site's REST API answers at `path`, through the gateway, to `body` when given; or the failure that stopped
   * the call reaching there, or that its answer stands for, as `failure` reads it.
   */
  async function api<T>(path: string, body?: unknown, failure: (received: Received) => FailedCall = failureOf): Promise<Got<T>> {
    if (cloudId === undefined) {
      const tenant = await send(transport, `https://${connection.site}/_edge/tenant_info`, {}, backoff)
      if (!tenant) return UNAVAILABLE
      if (tenant.status !== 200) return failureOf(tenant)
      cloudId = (tenant.body as { cloudId: string }).cloudId
    }
    const headers: Record<string, string> = { authorization, accept: 'application/json' }
    const init: RequestInit =
      body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
    return answered(await send(transport, `${GATEWAY}/${cloudId}/rest/api/3${path}`, init, backoff), failure)
  }

  /** The ids of the project's statuses in the Done category, looked up once. */
  async function doneStatusIds(): Promise<Got<Set<string>>> {
    if (doneStatuses === undefined) {
      const issueTypes = await api<IssueTypeStatuses[]>(`/project/${encodeURIComponent(key)}/statuses`)
      if (!issueTypes.ok) return issueTypes
      const statuses = issueTypes.value.flatMap((issueType) => issueType.statuses)
      doneStatuses = new Set(statuses.filter(done).map((status) => status.id))
    }
    return got(doneStatuses)
  }

  /**
   * Each ticket's last move into the Done category, as a UTC instant, from its changelog, fetched in bulk: a status
   * change from a status outside Done to one in it. A move between two Done statuses (Done to Won't Do) isn't a
   * finish. Bulk fetch promises no order, so the latest is found, not taken from the end.
   */
  async function lastMovesIntoDone(ids: string[]): Promise<Got<Map<string, string>>> {
    if (ids.length === 0) return got(new Map())
    const doneIds = await doneStatusIds()
    if (!doneIds.ok) return doneIds
    const intoDone = (item: ChangeItem) => item.fieldId === 'status' && doneIds.value.has(item.to ?? '') && !doneIds.value.has(item.from ?? '')
    /** In milliseconds since the epoch, as bulk fetch gives them. */
    const lastMs = new Map<string, number>()
    for (let start = 0; start < ids.length; start += CHANGELOG_BATCH) {
      const issueIdsOrKeys = ids.slice(start, start + CHANGELOG_BATCH)
      const changelogs = await everyPage(async (nextPageToken) => {
        const page = await api<ChangelogResponse>('/changelog/bulkfetch', { issueIdsOrKeys, fieldIds: ['status'], ...cursor(nextPageToken) })
        return page.ok ? got({ items: page.value.issueChangeLogs, nextPageToken: page.value.nextPageToken }) : page
      })
      if (!changelogs.ok) return changelogs
      for (const { issueId, changeHistories } of changelogs.value) {
        for (const { created, items } of changeHistories) {
          if (items.some(intoDone)) lastMs.set(issueId, Math.max(lastMs.get(issueId) ?? -Infinity, created))
        }
      }
    }
    return got(new Map([...lastMs].map(([id, ms]) => [id, new Date(ms).toISOString()])))
  }

  /** Every page of what search finds for `jql`, with `fields`. */
  function search<F>(jql: string, fields: string[]): Promise<Got<Found<F>[]>> {
    return everyPage(async (nextPageToken) => {
      const page = await api<SearchResponse<F>>('/search/jql', { jql, fields, maxResults: PAGE, ...cursor(nextPageToken) }, searchFailure)
      if (!page.ok) return page
      return got({ items: page.value.issues, nextPageToken: page.value.isLast === true ? undefined : page.value.nextPageToken })
    })
  }

  /** What search finds among the tickets `ids`, a batch at a time, by `jql` naming them. */
  async function searchByIds<F>(ids: string[], jql: (idList: string) => string, fields: string[]): Promise<Got<Found<F>[]>> {
    const found: Found<F>[] = []
    for (let start = 0; start < ids.length; start += ID_BATCH) {
      const batch = await search<F>(jql(`id in (${ids.slice(start, start + ID_BATCH).join(', ')})`), fields)
      if (!batch.ok) return batch
      found.push(...batch.value)
    }
    return got(found)
  }

  /** When each of the tickets `ids` was made, as a UTC instant. */
  async function createdAt(ids: string[]): Promise<Got<Map<string, string>>> {
    const found = await searchByIds<{ created: string }>(ids, (idList) => `project = "${key}" AND ${idList}`, ['created'])
    if (!found.ok) return found
    return got(new Map(found.value.map(({ id, fields }) => [id, new Date(jiraInstant(fields.created)).toISOString()])))
  }

  /**
   * `query` with each picked epic it names read as itself or any ticket above level 0 beneath it, found level by level
   * through `parent`: the picked tickets first, by key, then each level's children, while any is above level 1. Jira's
   * search gives every page, so it is never incomplete.
   */
  async function expanded(query: string): Promise<Expanded> {
    const keys = pickedEpicsIn(query, PICKED, (epic) => epic.toUpperCase())
    if (keys.length === 0) return { ok: true, query, incomplete: false }
    const picked = await search<LevelFields>(`project = "${key}" AND key in (${keys.join(', ')})`, ['issuetype'])
    if (!picked.ok) return picked
    /** The picked epic each ticket found is beneath, by the ticket's id (a picked epic beneath itself). */
    const pickedAbove = new Map(picked.value.map((ticket) => [ticket.id, ticket.key.toUpperCase()]))
    const beneath = new Map<string, string[]>()
    // A level's children are a level below it, so the levels run out at the hierarchy's foot.
    let level = picked.value.filter(({ fields }) => fields.issuetype.hierarchyLevel > 1)
    while (level.length > 0) {
      const children = await search<LevelFields>(`project = "${key}" AND parent in (${level.map(({ id }) => id).join(', ')})`, ['issuetype', 'parent'])
      if (!children.ok) return children
      level = []
      for (const child of children.value) {
        const above = child.fields.parent === undefined ? undefined : pickedAbove.get(child.fields.parent.id)
        if (above === undefined || pickedAbove.has(child.id) || child.fields.issuetype.hierarchyLevel < 1) continue
        pickedAbove.set(child.id, above)
        beneath.set(above, [...(beneath.get(above) ?? []), child.id])
        level.push(child)
      }
      level = level.filter(({ fields }) => fields.issuetype.hierarchyLevel > 1)
    }
    const withEpicsBeneath = withPickedEpics(query, PICKED, (epic) => {
      const found = beneath.get(epic.toUpperCase())
      return found === undefined ? undefined : `parent in (${[epic, ...found].join(', ')})`
    })
    return { ok: true, query: withEpicsBeneath, incomplete: false }
  }

  /** Every one of the project's unreleased fix versions: Jira gives them all at once. */
  async function unreleasedVersions(): Promise<Got<Choice[]>> {
    const versions = await api<Version[]>(`/project/${encodeURIComponent(key)}/versions`)
    if (!versions.ok) return versions
    return got(versions.value.filter((version) => !version.released && !version.archived).map((version) => fixVersionChoice(version.name)))
  }

  /** The project's unreleased fix versions; past the limit, the first are listed. */
  async function fixVersions(): Promise<Got<ChoicesOfKind>> {
    const choices = await unreleasedVersions()
    if (!choices.ok) return choices
    return got({ kind: 'fixVersion', choices: choices.value.slice(0, CHOICES_LIMIT), pastLimit: choices.value.length > CHOICES_LIMIT })
  }

  /** The unreleased fix versions with `text` in their names, ignoring case, up to the limit: matched here, as Jira gives them all. */
  async function searchedVersions(text: string): Promise<SearchedChoices> {
    const choices = await unreleasedVersions()
    if (!choices.ok) return choices
    const typed = text.toLowerCase()
    return { ok: true, choices: choices.value.filter((choice) => choice.name.toLowerCase().includes(typed)).slice(0, CHOICES_LIMIT) }
  }

  /**
   * The project's epics not yet done, and matching `clause` too, when given, up to the limit: the first page, newest
   * first, which says whether there are more.
   */
  async function epics(clause = ''): Promise<Got<ChoicesOfKind>> {
    const jql = `project = "${key}" AND issuetype = Epic AND statusCategory != Done${clause} ORDER BY created DESC`
    const page = await api<SearchResponse<{ summary: string }>>('/search/jql', { jql, fields: ['summary'], maxResults: CHOICES_LIMIT })
    if (!page.ok) return page
    return got({ kind: 'epic', choices: page.value.issues.map(epicChoice), pastLimit: page.value.isLast !== true })
  }

  /**
   * The epics not done with a word starting with each word of `text` in their summaries, up to the limit. Text
   * search's special characters are left out, so none can make the JQL fail.
   */
  async function searchedEpics(text: string): Promise<SearchedChoices> {
    const words = text
      .replace(TEXT_SEARCH_SPECIALS, ' ')
      .split(/\s+/)
      .filter((word) => word !== '')
    return searchedIn(await epics(words.map((word) => ` AND summary ~ "${word}*"`).join('')))
  }

  /** The site's labels JQL suggests for `text`, as it autocompletes the labels field, up to the limit. */
  async function searchedLabels(text: string): Promise<SearchedChoices> {
    const suggested = await api<{ results: { value: string }[] }>(`/jql/autocompletedata/suggestions?fieldName=labels&fieldValue=${encodeURIComponent(text)}`)
    if (!suggested.ok) return suggested
    return { ok: true, choices: suggested.value.results.slice(0, CHOICES_LIMIT).map(({ value }) => labelChoice(value)) }
  }

  const SEARCHES: ChoiceSearches = { fixVersion: searchedVersions, epic: searchedEpics, label: searchedLabels }

  /** The site's labels: Jira keeps labels for the whole site, not per project. */
  async function labels(): Promise<Got<ChoicesOfKind>> {
    const page = await api<LabelsResponse>(`/label?maxResults=${CHOICES_LIMIT}`)
    if (!page.ok) return page
    return got({ kind: 'label', choices: page.value.values.map(labelChoice), pastLimit: page.value.isLast !== true })
  }

  return {
    searchChoices: searchChoicesIn(SEARCHES),

    milestoneChoices: () => milestoneChoicesOf([fixVersions, () => epics(), labels]),

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const withEpicsBeneath = await expanded(query)
      if (!withEpicsBeneath.ok) return withEpicsBeneath
      const before = jqlBefore(since)
      const inWindow = `(statusCategory != Done OR status CHANGED AFTER "${before}" OR created >= "${before}")`
      const found = await search<ReadFields>(`project = "${key}" AND (${withEpicsBeneath.query}) AND ${inWindow}`, FIELDS)
      if (!found.ok) return found
      const matched = found.value
      if (matched.length === 0) {
        // Search matches nothing, rather than failing, on a project that doesn't exist or can't be seen.
        const project = await api(`/project/${encodeURIComponent(key)}`)
        if (!project.ok) return project
      }

      // A story the window leaves out (Done, unchanged since) can have a subtask open again, or finished since: its
      // subtasks still count. Its subtasks in the window name it; it is read if the query matches it.
      const subtasks = await search<{ parent?: { id: string } }>(`project = "${key}" AND issuetype in subTaskIssueTypes() AND ${inWindow}`, ['parent'])
      if (!subtasks.ok) return subtasks
      const matchedIds = new Set(matched.map(({ id }) => id))
      const storiesLeftOut = [
        ...new Set(subtasks.value.flatMap(({ fields }) => (fields.parent === undefined || matchedIds.has(fields.parent.id) ? [] : [fields.parent.id]))),
      ]
      const stories = await searchByIds<ReadFields>(storiesLeftOut, (idList) => `project = "${key}" AND (${withEpicsBeneath.query}) AND ${idList}`, FIELDS)
      if (!stories.ok) return stories
      matched.push(...stories.value)

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
      if (!movedIntoDone.ok) return movedIntoDone
      // In Done with no move into it, a ticket was made there: it finished when it was made.
      const madeAt = await createdAt(finishedIds.filter((id) => !movedIntoDone.value.has(id)))
      if (!madeAt.ok) return madeAt
      const tickets: Ticket[] = []
      for (const [id, finished] of isFinished) {
        const finishedAt = finished ? (movedIntoDone.value.get(id) ?? madeAt.value.get(id)) : undefined
        if (!finished) tickets.push({ id })
        else if (finishedAt !== undefined) tickets.push({ id, finishedAt })
      }
      // The JQL's lower bound is a day early; this keeps the window exact.
      return { ok: true, tickets: finishedSince(tickets, since), incomplete: withEpicsBeneath.incomplete }
    },
  }
}
