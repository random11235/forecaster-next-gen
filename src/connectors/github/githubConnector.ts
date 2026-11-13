import type { Connection } from '../../model/connection.js'
import {
  CHOICES_LIMIT,
  type Choice,
  type ChoiceKind,
  type ChoicesOfKind,
  type Connector,
  type FailedCall,
  type ReadResult,
  type SearchedChoices,
  type Ticket,
  type Transport,
} from '../connector.js'
import {
  answered,
  failureOf as statusFailure,
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
 * Search's open issues with sub-issues and no parent: the repo's top-level epics still open. A sub-epic isn't listed,
 * as picking its top-level epic picks it; nor is a closed epic, whose milestone is done.
 */
const TOP_LEVEL_EPICS = 'is:issue is:open has:sub-issue no:parent-issue'

/**
 * The qualifier reading an epic's tickets: the repo named in full, as search's short forms (`parent-issue:#N`,
 * `parent-issue:N`) match nothing, with no error.
 */
function epicQuery(repo: string, number: number): string {
  return `parent-issue:${repo}#${number}`
}

// Each kind's choice is built here and nowhere else, so a choice listed and the same one searched for read alike.

/** An epic's choice: named by its title, and read by its sub-issues. */
function epicChoice(repo: string, { number, title }: Pick<Issue, 'number' | 'title'>): Choice {
  return { kind: 'epic', name: title, query: epicQuery(repo, number) }
}

/** A label's choice. Search quotes values in double quotes, with no escapes. */
function labelChoice(name: string): Choice {
  return { kind: 'label', name, query: `label:"${name}"` }
}

/** A milestone's choice, read by its title. */
function milestoneChoice(title: string): Choice {
  return { kind: 'milestone', name: title, query: `milestone:"${title}"` }
}

/** How many levels down a picked epic's sub-epics are looked for: as deep as GitHub nests sub-issues. */
const EPIC_LEVELS = 8

/**
 * Each picked epic a query names, as its choice reads it: `parent-issue:` with the repo in full, not negated and not
 * in quotes. A quoted value is matched too, with no epic number, so a term inside quotes is kept as written.
 */
function pickedEpics(repo: string): PickedEpics {
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return pickedEpicsPattern(new RegExp(`"[^"]*"|(?<=^|[\\s(])parent-issue:${escaped}#(\\d+)(?=$|[\\s)])`, 'i'))
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
  return statusFailure(received)
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

  /** What GitHub answers at `path`, rate limits backed off; or the failure its answer stands for, as `failure` reads it. */
  async function get<T>(path: string, failure: (received: Received) => FailedCall = failureOf): Promise<Got<T>> {
    return answered(await send(transport, `${API}${path}`, { headers }, backoff), failure)
  }

  /** One page of what issue search finds for `q`, `paging` naming the page. */
  function search(q: string, paging: string): Promise<Got<SearchResponse>> {
    return get<SearchResponse>(`/search/issues?q=${encodeURIComponent(q)}&advanced_search=true&${paging}`, searchFailure)
  }

  /**
   * The open top-level epics, those `matching` more search terms when given, up to the limit: one search, whose count
   * says whether there are more.
   */
  async function epics(matching = ''): Promise<Got<ChoicesOfKind>> {
    const found = await search(`repo:${repo} ${TOP_LEVEL_EPICS}${matching}`, `per_page=${CHOICES_LIMIT}`)
    if (!found.ok) return found
    const { items, total_count } = found.value
    return got({ kind: 'epic', choices: items.map((issue) => epicChoice(repo, issue)), pastLimit: total_count > CHOICES_LIMIT })
  }

  /**
   * The first `CHOICES_LIMIT` of a REST list (`path` with its own parameters, if any, ending in `?` or `&`), each of
   * its items the choice of `kind` that `choiceOf` makes of it.
   */
  async function listed<T>(kind: ChoiceKind, path: string, choiceOf: (item: T) => Choice): Promise<Got<ChoicesOfKind>> {
    const items = await get<T[]>(`${path}per_page=${CHOICES_LIMIT}`)
    if (!items.ok) return items
    let pastLimit = false
    if (items.value.length === CHOICES_LIMIT) {
      // A full page may be all of them: whether there is one more is asked only then, as one item past the limit.
      const next = await get<unknown[]>(`${path}per_page=1&page=${CHOICES_LIMIT + 1}`)
      if (!next.ok) return next
      pastLimit = next.value.length > 0
    }
    return got({ kind, choices: items.value.map(choiceOf), pastLimit })
  }

  /**
   * The open top-level epics with every word of `text` in their titles, up to the limit. Each word is quoted, so none
   * is read as a qualifier; search matches whole words only.
   */
  async function searchedEpics(text: string): Promise<SearchedChoices> {
    const words = text.replace(/"/g, ' ').split(/\s+/).filter((word) => word !== '')
    return searchedIn(await epics(` in:title ${words.map((word) => `"${word}"`).join(' ')}`))
  }

  let repoId: number | undefined

  /** The labels search finds for `text` in the repo, which it names by id, looked up once; up to the limit. */
  async function searchedLabels(text: string): Promise<SearchedChoices> {
    if (repoId === undefined) {
      const found = await get<{ id: number }>(`/repos/${repo}`)
      if (!found.ok) return found
      repoId = found.value.id
    }
    const path = `/search/labels?repository_id=${repoId}&q=${encodeURIComponent(text)}&per_page=${CHOICES_LIMIT}`
    const found = await get<{ items: { name: string }[] }>(path, searchFailure)
    return found.ok ? { ok: true, choices: found.value.items.map(({ name }) => labelChoice(name)) } : found
  }

  /**
   * The open milestones with `text` in their titles, ignoring case, up to the limit. GitHub has no milestone search,
   * so every page is read and matched here.
   */
  async function searchedMilestones(text: string): Promise<SearchedChoices> {
    const typed = text.toLowerCase()
    const choices: Choice[] = []
    for (let page = 1; ; page++) {
      const milestones = await get<{ title: string }[]>(`/repos/${repo}/milestones?state=open&per_page=${PAGE}&page=${page}`)
      if (!milestones.ok) return milestones
      for (const { title } of milestones.value) {
        if (title.toLowerCase().includes(typed)) choices.push(milestoneChoice(title))
      }
      if (milestones.value.length < PAGE || choices.length >= CHOICES_LIMIT) break
    }
    return { ok: true, choices: choices.slice(0, CHOICES_LIMIT) }
  }

  const SEARCHES: ChoiceSearches = { epic: searchedEpics, label: searchedLabels, milestone: searchedMilestones }

  /**
   * Every issue search finds for `q`, page by page, up to the 1,000 it gives: past that, or when search says it timed
   * out, they are incomplete.
   */
  async function everyIssue(q: string): Promise<{ ok: true; issues: Issue[]; incomplete: boolean } | FailedCall> {
    const issues: Issue[] = []
    let incomplete = false
    for (let page = 1; ; page++) {
      const found = await search(q, `per_page=${PAGE}&page=${page}`)
      if (!found.ok) return found
      const results = found.value
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
  async function expanded(query: string): Promise<Expanded> {
    const picked = pickedEpics(repo)
    const epics = pickedEpicsIn(query, picked).map(Number)
    if (epics.length === 0) return { ok: true, query, incomplete: false }
    /** Each epic found, by the picked epic it is beneath (a picked epic beneath itself). */
    const pickedAbove = new Map(epics.map((epic) => [epic, epic]))
    let incomplete = false
    let level = epics
    for (let depth = 0; depth < EPIC_LEVELS && level.length > 0; depth++) {
      const found = await everyIssue(`repo:${repo} is:issue has:sub-issue (${level.map((epic) => epicQuery(repo, epic)).join(' OR ')})`)
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
    const withSubEpics = withPickedEpics(query, picked, (epic) => {
      const beneath = [...pickedAbove].filter(([found, above]) => above === Number(epic) && found !== above).map(([found]) => found)
      return beneath.length === 0 ? undefined : `(${[Number(epic), ...beneath].map((each) => epicQuery(repo, each)).join(' OR ')})`
    })
    return { ok: true, query: withSubEpics, incomplete }
  }

  return {
    searchChoices: searchChoicesIn(SEARCHES),

    // Three requests, and one more for each full list.
    milestoneChoices: () =>
      milestoneChoicesOf([
        () => epics(),
        () => listed<{ name: string }>('label', `/repos/${repo}/labels?`, ({ name }) => labelChoice(name)),
        () => listed<{ title: string }>('milestone', `/repos/${repo}/milestones?state=open&`, ({ title }) => milestoneChoice(title)),
      ]),

    read: async (query, since): Promise<ReadResult> => {
      if (!staysInScope(query, SCOPE)) return { ok: false, failure: 'outOfScope' }
      const withSubEpics = await expanded(query)
      if (!withSubEpics.ok) return withSubEpics
      const leaves = await everyIssue(`repo:${repo} is:issue no:sub-issue (${withSubEpics.query}) (is:open OR closed:>=${searchDate(since)})`)
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
