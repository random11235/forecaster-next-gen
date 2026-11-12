import type { Connection } from '../../model/connection.js'
import { CHOICES_LIMIT, type ChoicesOfKind, type Connector, type FailedCall, type ReadResult, type Ticket, type Transport } from '../connector.js'
import { failureOf as statusFailure, finishedSince, send, sleep, staysInScope, type Backoff, type QueryScope, type Received, type Wait } from '../remote.js'

/**
 * The GitHub connector. It reads through GitHub's REST API: issue search, rather than GraphQL's, because only REST
 * refuses a query it can't parse, with its own message, where GraphQL silently matches nothing (#156).
 *
 * A read is the repo's open leaf issues the query matches, plus those closed since `finishedSince`, each finished at
 * its last close (`closed_at`); the project board isn't read. `is:issue` leaves out pull requests and `no:sub-issue`
 * parents. Every page is read, up to the 1,000 results search gives, past which the read is incomplete.
 *
 * A picked epic (`parent-issue:owner/repo#N`, as its choice reads it) stands for every leaf beneath it, through any
 * sub-epics: before each read, its sub-epics are found level by level, and the epic is read as itself or any of them.
 * The query keeps only the epic, so a sub-epic added since is found on the next read.
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

/**
 * Search's issues with sub-issues and no parent: the repo's top-level epics. A sub-epic isn't listed, as picking its
 * top-level epic picks it.
 */
const TOP_LEVEL_EPICS = 'is:issue has:sub-issue no:parent-issue'

/**
 * The qualifier reading an epic's tickets: the repo named in full, as search's short forms (`parent-issue:#N`,
 * `parent-issue:N`) match nothing, with no error.
 */
function epicQuery(repo: string, number: number): string {
  return `parent-issue:${repo}#${number}`
}

/** How many levels down a picked epic's sub-epics are looked for: as deep as GitHub nests sub-issues. */
const EPIC_LEVELS = 8

/**
 * Each picked epic a query names, as its choice reads it: `parent-issue:` with the repo in full, not negated and not
 * in quotes. A quoted value is matched too, with no epic number, so a term inside quotes is kept as written.
 */
function pickedEpics(repo: string): RegExp {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`"[^"]*"|(?<=^|[\\s(])parent-issue:${escaped}#(\\d+)(?=$|[\\s)])`, 'gi')
}

/** A searched issue's number, from the URL GitHub gives for it. */
function numberOf(issueUrl: string): number {
  return Number(issueUrl.slice(issueUrl.lastIndexOf('/') + 1))
}

type Issue = {
  node_id: string
  number: number
  title: string
  state: 'open' | 'closed'
  closed_at: string | null
  /** Only on a sub-issue. */
  parent_issue_url?: string | null
}

interface SearchResponse {
  total_count: number
  incomplete_results: boolean
  items: Issue[]
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

/**
 * The failure an unsuccessful search stands for. Search names an unknown or unseen repo with a 422 that says so,
 * rather than a 404; any other 422 refuses the query, with GitHub's message.
 */
function searchFailure(received: Received): FailedCall {
  if (received.status !== 422) return failureOf(received)
  const body = received.body as ErrorResponse
  const message = body.errors?.[0]?.message ?? body.message ?? ''
  if (/cannot be searched/.test(message)) return { ok: false, failure: 'notFound' }
  return { ok: false, failure: 'invalidQuery', message }
}

/** One kind's choices, or the failure that stopped them being listed. */
type Listed = ({ ok: true } & ChoicesOfKind) | FailedCall

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

  /** The top-level epics, up to the limit: one search, whose count says whether there are more. */
  async function epics(): Promise<Listed> {
    const q = encodeURIComponent(`repo:${repo} ${TOP_LEVEL_EPICS}`)
    const response = await get(`/search/issues?q=${q}&advanced_search=true&per_page=${CHOICES_LIMIT}`)
    if (!response) return { ok: false, failure: 'unavailable' }
    if (response.status !== 200) return searchFailure(response)
    const found = response.body as SearchResponse
    const choices = found.items.map(({ number, title }) => ({ kind: 'epic', name: title, query: epicQuery(repo, number) }))
    return { ok: true, kind: 'epic', choices, pastLimit: found.total_count > CHOICES_LIMIT }
  }

  /**
   * The first `CHOICES_LIMIT` of a REST list (`path` with its own parameters, if any, ending in `?` or `&`), each a
   * choice of `kind` named by `nameOf` and read by `qualifier`, its value quoted.
   */
  async function listed<T>(kind: string, path: string, nameOf: (item: T) => string, qualifier: string): Promise<Listed> {
    const response = await get(`${path}per_page=${CHOICES_LIMIT}`)
    if (!response) return { ok: false, failure: 'unavailable' }
    if (response.status !== 200) return failureOf(response)
    const items = response.body as T[]
    const choices = items.map(nameOf).map((name) => ({ kind, name, query: `${qualifier}:"${name}"` }))
    let pastLimit = false
    if (items.length === CHOICES_LIMIT) {
      // A full page may be all of them: whether there is one more is asked only then, as one item past the limit.
      const next = await get(`${path}per_page=1&page=${CHOICES_LIMIT + 1}`)
      if (!next) return { ok: false, failure: 'unavailable' }
      if (next.status !== 200) return failureOf(next)
      pastLimit = (next.body as unknown[]).length > 0
    }
    return { ok: true, kind, choices, pastLimit }
  }

  /**
   * Every issue search finds for `q`, page by page, up to the 1,000 it gives: past that, or when search says it timed
   * out, they are incomplete.
   */
  async function searched(q: string): Promise<{ ok: true; issues: Issue[]; incomplete: boolean } | FailedCall> {
    const issues: Issue[] = []
    let incomplete = false
    for (let page = 1; ; page++) {
      const response = await get(`/search/issues?q=${encodeURIComponent(q)}&advanced_search=true&per_page=${PAGE}&page=${page}`)
      if (!response) return { ok: false, failure: 'unavailable' }
      if (response.status !== 200) return searchFailure(response)
      const results = response.body as SearchResponse
      issues.push(...results.items)
      incomplete ||= results.incomplete_results
      const read = (page - 1) * PAGE + results.items.length
      if (results.items.length < PAGE || read >= results.total_count) return { ok: true, issues, incomplete }
      if (read >= SEARCH_CAP) return { ok: true, issues, incomplete: true }
    }
  }

  /**
   * `query` with each picked epic it names read as itself or any of its sub-epics, found level by level, one search a
   * level, at most `EPIC_LEVELS`. Incomplete when a level's search was.
   */
  async function expanded(query: string): Promise<{ ok: true; query: string; incomplete: boolean } | FailedCall> {
    const picked = pickedEpics(repo)
    const epics = [...query.matchAll(picked)].flatMap((match) => (match[1] === undefined ? [] : [Number(match[1])]))
    if (epics.length === 0) return { ok: true, query, incomplete: false }
    /** Each epic found, by the picked epic it is beneath (a picked epic beneath itself). */
    const pickedAbove = new Map(epics.map((epic) => [epic, epic]))
    let incomplete = false
    let level = [...new Set(epics)]
    for (let depth = 0; depth < EPIC_LEVELS && level.length > 0; depth++) {
      const found = await searched(`repo:${repo} is:issue has:sub-issue (${level.map((epic) => epicQuery(repo, epic)).join(' OR ')})`)
      if (!found.ok) return found
      incomplete ||= found.incomplete
      level = []
      for (const { number, parent_issue_url } of found.issues) {
        const above = parent_issue_url ? pickedAbove.get(numberOf(parent_issue_url)) : undefined
        if (above === undefined || pickedAbove.has(number)) continue
        pickedAbove.set(number, above)
        level.push(number)
      }
    }
    const withSubEpics = query.replace(picked, (term, epic: string | undefined) => {
      if (epic === undefined) return term
      const beneath = [...pickedAbove].filter(([found, above]) => above === Number(epic) && found !== above).map(([found]) => found)
      return beneath.length === 0 ? term : `(${[Number(epic), ...beneath].map((each) => epicQuery(repo, each)).join(' OR ')})`
    })
    return { ok: true, query: withSubEpics, incomplete }
  }

  return {
    milestoneChoices: async () => {
      const kinds: ChoicesOfKind[] = []
      // Asked one after another, stopping at the first failure: three requests, and one more for each full list.
      for (const list of [
        epics,
        () => listed<{ name: string }>('label', `/repos/${repo}/labels?`, ({ name }) => name, 'label'),
        () => listed<{ title: string }>('milestone', `/repos/${repo}/milestones?state=open&`, ({ title }) => title, 'milestone'),
      ]) {
        const result = await list()
        if (!result.ok) return result
        const { ok: _, ...kind } = result
        kinds.push(kind)
      }
      return { ok: true, kinds }
    },

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const withSubEpics = await expanded(query)
      if (!withSubEpics.ok) return withSubEpics
      const leaves = await searched(`repo:${repo} is:issue no:sub-issue (${withSubEpics.query}) (is:open OR closed:>=${searchDate(since)})`)
      if (!leaves.ok) return leaves
      const tickets: Ticket[] = leaves.issues.map((issue) =>
        issue.state === 'closed' && issue.closed_at ? { id: issue.node_id, finishedAt: issue.closed_at } : { id: issue.node_id },
      )
      const incomplete = withSubEpics.incomplete || leaves.incomplete
      // Search compares to the second; this keeps the window exact.
      return { ok: true, tickets: finishedSince(tickets, since), incomplete }
    },
  }
}
