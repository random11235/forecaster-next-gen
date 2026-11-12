import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { jiraConnector } from '../../../src/connectors/jira/jiraConnector.js'
import { answering, mustNotWait, noWait } from '../backoff.js'
import { replayTransport } from '../replayTransport.js'
import { jiraSubject } from './jiraSubject.js'

// Jira-only quirks, beside the contract suite. A read's JQL is wrapped as `project = "KEY" AND (query)`, so a query
// naming a project, or closing the wrapper's parenthesis, would reach past the connection. JQL reads date literals in
// the token user's time zone, its changelogs come in no promised order, and its API is reached through Atlassian's
// gateway, by the site's cloud id.

const CONNECTION = { tracker: 'jira', site: 'example.atlassian.net', projectKey: 'SYN', email: 'someone@example.com' } as const
const SINCE = '2026-01-01T00:00:00Z'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A level-0 ticket with no subtasks, in a status of the category `category`, as search returns it. */
function issue(id: string, category = 'new'): unknown {
  return { id, fields: { issuetype: { hierarchyLevel: 0 }, status: { statusCategory: { key: category } }, subtasks: [] } }
}

/** The project's statuses, by id: To Do, In Progress, and two in the Done category, Done and Won't Do. */
const TO_DO = '1'
const DONE = '3'
const WONT_DO = '4'
const STATUSES = [
  { id: TO_DO, statusCategory: { key: 'new' } },
  { id: '2', statusCategory: { key: 'indeterminate' } },
  { id: DONE, statusCategory: { key: 'done' } },
  { id: WONT_DO, statusCategory: { key: 'done' } },
]

/** One status change in a changelog, at `at`, as bulk fetch gives it: in milliseconds since the epoch. */
function statusChange(at: string, from = TO_DO, to = DONE): unknown {
  return { created: Date.parse(at), items: [{ fieldId: 'status', from, to }] }
}

/** What a stand-in Jira holds besides what the read's own search finds. */
interface Site {
  /** Each ticket's changelog, keyed by id. */
  changelogs?: Record<string, unknown[]>
  /** When each ticket was made, as Jira writes it. */
  created?: Record<string, string>
  /** The subtasks open or changed in the window, as search returns them, with their parents' ids. */
  subtasksInWindow?: { id: string; parent: string }[]
  /** Tickets the query matches that fall outside the window, by id. */
  outsideWindow?: Record<string, unknown>
}

/**
 * A stand-in Jira whose search for the read's query finds `issues`, one page, and whose bulk fetch gives each ticket
 * the changelog in `site.changelogs`. `searched` and `fetched` collect what was asked of each.
 */
function jiraFinding(issues: unknown[], site: Site = {}) {
  const searched: { jql: string; nextPageToken?: string }[] = []
  const fetched: string[][] = []
  const transport: Transport = async (url, init) => {
    if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
    if (url.endsWith('/project/SYN/statuses')) return json(200, [{ statuses: STATUSES }])
    const body = JSON.parse(String(init?.body)) as { jql: string; issueIdsOrKeys: string[] }
    if (url.endsWith('/search/jql')) {
      searched.push(body)
      return json(200, { issues: searchOf(body.jql, issues, site), isLast: true })
    }
    fetched.push(body.issueIdsOrKeys)
    return json(200, {
      issueChangeLogs: body.issueIdsOrKeys.map((id) => ({ issueId: id, changeHistories: site.changelogs?.[id] ?? [] })),
    })
  }
  return { transport, searched, fetched }
}

/** What the stand-in's search finds for `jql`: the read's own search, or one of the connector's lookups by id. */
function searchOf(jql: string, issues: unknown[], site: Site): unknown[] {
  const ids = /\bid in \(([^)]*)\)/.exec(jql)?.[1]?.split(', ') ?? []
  if (jql.includes('subTaskIssueTypes()')) return (site.subtasksInWindow ?? []).map(({ id, parent }) => ({ id, fields: { parent: { id: parent } } }))
  if (jql.startsWith('project = "SYN" AND id in (')) return ids.map((id) => ({ id, fields: { created: site.created?.[id] } }))
  if (ids.length > 0) return ids.flatMap((id) => (site.outsideWindow?.[id] === undefined ? [] : [site.outsideWindow[id]]))
  return issues
}

/** A stand-in Jira that gives its cloud id, then answers each call through the gateway with `answer`. */
function answeringPastTenant(answer: Transport) {
  return answering(async (url, init) => (url.endsWith('/_edge/tenant_info') ? json(200, { cloudId: 'cloud-1' }) : answer(url, init)))
}

function throughGateway(url: string): boolean {
  return !url.endsWith('/_edge/tenant_info')
}

describe('Jira connector', () => {
  test("signs in as the connection's account email with the token, which holds no email of its own", async () => {
    const sent: (string | null)[] = []
    const jira = jiraListing({})
    const connector = jiraConnector(CONNECTION, 'ATATT-token', async (url, init) => {
      if (throughGateway(url)) sent.push(new Headers(init?.headers).get('authorization'))
      return jira.transport(url, init)
    })

    expect((await connector.milestoneChoices()).ok).toBe(true)
    expect(new Set(sent)).toEqual(new Set([`Basic ${btoa('someone@example.com:ATATT-token')}`]))
  })

  test.each([
    ['a project', 'project = KAN'],
    ['a project, among others', 'labels = a OR project in (KAN, SYN)'],
    ['a project, in parentheses', '(project != SYN)'],
    ['a closing parenthesis that escapes the wrapper', 'labels = a) OR (labels = b'],
    ['a closing parenthesis between quoted values', 'labels = "a") OR (labels = \'b\''],
  ])('a query naming %s is outOfScope, with no request made', async (_, query) => {
    // An empty replay throws on any request, so a request made would fail this test.
    const connector = jiraConnector(CONNECTION, 'token', replayTransport([]))

    expect(await connector.read(query, SINCE)).toEqual({ ok: false, failure: 'outOfScope' })
  })

  test.each([
    ['a closing parenthesis in double quotes', 'labels = "a)"'],
    ['a closing parenthesis in single quotes', "labels = 'a)'"],
    ['quoted parentheses either way round', 'labels = ")" OR labels = "wip (old"'],
    ['a quoted parenthesis after an escaped quote', 'summary ~ "say \\") hi"'],
  ])('a query with %s stays in scope and is searched', async (_, query) => {
    const { transport, searched } = jiraFinding([issue('1')])
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read(query, SINCE)).toEqual({ ok: true, tickets: [{ id: '1' }], incomplete: false })
    expect(searched[0]!.jql.startsWith(`project = "SYN" AND (${query}) AND (`)).toBe(true)
  })

  test("finishedSince goes into JQL a day early, so it isn't late in the token user's time zone, whichever that is", async () => {
    // JQL reads date literals in the token user's time zone, which a read-only token can't look up; time zones run
    // from 12 hours behind UTC to 14 ahead, so a day before finishedSince, read in any of them, is before it.
    const { transport, searched } = jiraFinding([issue('1')])
    const connector = jiraConnector(CONNECTION, 'token', transport)

    await connector.read('labels = a', '2026-01-01T05:30:45Z')

    expect(searched[0]!.jql).toBe(
      'project = "SYN" AND (labels = a) AND (statusCategory != Done OR status CHANGED AFTER "2025-12-31 05:30" OR created >= "2025-12-31 05:30")',
    )
  })

  test('a ticket made in a Done status, never moved into Done, is finished when it was made', async () => {
    // Finished means in the Done category now; with no move into Done, its finish is its making. Search reaches it in
    // the window by when it was made (above); bulk fetch gives it no move into Done.
    const { transport } = jiraFinding([issue('made-done', 'done'), issue('then-wont-do', 'done')], {
      changelogs: { 'then-wont-do': [statusChange('2026-03-05T00:00:00Z', DONE, WONT_DO)] },
      created: { 'made-done': '2026-03-01T10:00:00.000+1100', 'then-wont-do': '2026-03-02T00:00:00.000+0000' },
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({
      ok: true,
      tickets: [
        { id: 'made-done', finishedAt: '2026-02-28T23:00:00.000Z' },
        { id: 'then-wont-do', finishedAt: '2026-03-02T00:00:00.000Z' },
      ],
      incomplete: false,
    })
  })

  test('the day early is read but compared as instants: a ticket finished before finishedSince is left out', async () => {
    const { transport } = jiraFinding([issue('early', 'done'), issue('onTime', 'done'), issue('open', 'indeterminate')], {
      changelogs: {
      early: [statusChange('2026-01-01T05:30:44Z')],
      onTime: [statusChange('2026-01-01T05:30:45Z')],
      open: [statusChange('2025-06-01T00:00:00Z')],
      },
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', '2026-01-01T05:30:45Z')).toEqual({
      ok: true,
      tickets: [{ id: 'onTime', finishedAt: '2026-01-01T05:30:45.000Z' }, { id: 'open' }],
      incomplete: false,
    })
  })

  test('a changelog returned newest first gives the last finish, not the first', async () => {
    // Reopened: finished, back to To Do, finished again. Bulk fetch promises no order, so it can come newest first.
    const { transport } = jiraFinding([issue('1', 'done')], {
      changelogs: {
        '1': [statusChange('2026-03-03T00:00:00Z'), statusChange('2026-03-02T00:00:00Z', DONE, TO_DO), statusChange('2026-03-01T00:00:00Z')],
      },
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: true, tickets: [{ id: '1', finishedAt: '2026-03-03T00:00:00.000Z' }], incomplete: false })
  })

  test("a move from one Done-category status to another isn't a finish: the last finish is the last move into Done", async () => {
    // Done, then Won't Do: both in the Done category, so the ticket finished when it first moved into Done.
    const { transport } = jiraFinding([issue('1', 'done')], {
      changelogs: { '1': [statusChange('2026-03-05T00:00:00Z', DONE, WONT_DO), statusChange('2026-03-01T00:00:00Z', TO_DO, DONE)] },
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: true, tickets: [{ id: '1', finishedAt: '2026-03-01T00:00:00.000Z' }], incomplete: false })
  })

  test("changelogs are fetched for finished tickets only, up to 1,000 tickets a call", async () => {
    const finished = Array.from({ length: 1500 }, (_, k) => String(k + 1))
    const { transport, fetched } = jiraFinding([...finished.map((id) => issue(id, 'done')), issue('open')], {
      changelogs: Object.fromEntries(finished.map((id) => [id, [statusChange('2026-03-01T00:00:00Z')]])),
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    await connector.read('labels = a', SINCE)

    expect(fetched).toEqual([finished.slice(0, 1000), finished.slice(1000)])
  })

  test('every page of a changelog fetch is read', async () => {
    const pages = [
      { issueChangeLogs: [{ issueId: '1', changeHistories: [statusChange('2026-03-01T00:00:00Z')] }], nextPageToken: 'more' },
      { issueChangeLogs: [{ issueId: '1', changeHistories: [statusChange('2026-03-02T00:00:00Z', DONE, TO_DO), statusChange('2026-03-05T00:00:00Z')] }] },
    ]
    const connector = jiraConnector(CONNECTION, 'token', async (url, init) => {
      if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
      if (url.endsWith('/project/SYN/statuses')) return json(200, [{ statuses: STATUSES }])
      if (url.endsWith('/search/jql')) return json(200, { issues: [issue('1', 'done')], isLast: true })
      return json(200, (JSON.parse(String(init?.body)) as { nextPageToken?: string }).nextPageToken === 'more' ? pages[1] : pages[0])
    })

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: true, tickets: [{ id: '1', finishedAt: '2026-03-05T00:00:00.000Z' }], incomplete: false })
  })

  test("a story's subtasks are read with it, each once, though a subtask the query matches is also returned itself", async () => {
    const story = {
      id: 'story',
      fields: {
        issuetype: { hierarchyLevel: 0 },
        status: { statusCategory: { key: 'indeterminate' } },
        subtasks: [
          { id: 'sub-1', fields: { status: { statusCategory: { key: 'done' } } } },
          { id: 'sub-2', fields: { status: { statusCategory: { key: 'new' } } } },
        ],
      },
    }
    const subtask = { id: 'sub-2', fields: { issuetype: { hierarchyLevel: -1 }, status: { statusCategory: { key: 'new' } }, subtasks: [] } }
    const { transport } = jiraFinding([story, subtask], { changelogs: { 'sub-1': [statusChange('2026-03-01T00:00:00Z')] } })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({
      ok: true,
      tickets: [{ id: 'sub-1', finishedAt: '2026-03-01T00:00:00.000Z' }, { id: 'sub-2' }],
      incomplete: false,
    })
  })

  test("a story finished before finishedSince still gives its subtasks open or finished since, though search's window leaves it out", async () => {
    // The story is Done, unchanged since long ago, so the window leaves it out; one subtask was reopened and is open,
    // another finished since. Each is a ticket of the query, through its story.
    const story = {
      id: 'story',
      fields: {
        issuetype: { hierarchyLevel: 0 },
        status: { statusCategory: { key: 'done' } },
        subtasks: [
          { id: 'reopened', fields: { status: { statusCategory: { key: 'new' } } } },
          { id: 'finished-since', fields: { status: { statusCategory: { key: 'done' } } } },
          { id: 'finished-before', fields: { status: { statusCategory: { key: 'done' } } } },
        ],
      },
    }
    const { transport, searched } = jiraFinding([issue('other')], {
      subtasksInWindow: [
        { id: 'reopened', parent: 'story' },
        { id: 'finished-since', parent: 'story' },
        { id: 'elsewhere', parent: 'unmatched-story' },
      ],
      outsideWindow: { story },
      changelogs: {
        'finished-since': [statusChange('2026-03-01T00:00:00Z')],
        'finished-before': [statusChange('2025-06-01T00:00:00Z')],
      },
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({
      ok: true,
      tickets: [{ id: 'other' }, { id: 'reopened' }, { id: 'finished-since', finishedAt: '2026-03-01T00:00:00.000Z' }],
      incomplete: false,
    })
    expect(searched.map(({ jql }) => jql).slice(1)).toEqual([
      'project = "SYN" AND issuetype in subTaskIssueTypes() AND (statusCategory != Done OR status CHANGED AFTER "2025-12-31 00:00" OR created >= "2025-12-31 00:00")',
      'project = "SYN" AND (labels = a) AND id in (story, unmatched-story)',
    ])
  })

  test('search matches nothing on a project that is not there, so a read that finds nothing asks for the project', async () => {
    const asked: string[] = []
    const connector = jiraConnector(CONNECTION, 'token', async (url) => {
      asked.push(url.replace(/^.*\/rest\/api\/3/, ''))
      if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
      if (url.endsWith('/project/SYN')) return json(404, { errorMessages: ["No project could be found with key 'SYN'."] })
      return json(200, { issues: [], isLast: true })
    })

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: false, failure: 'notFound' })
    expect(asked).toEqual(['https://example.atlassian.net/_edge/tenant_info', '/search/jql', '/project/SYN'])
  })

  test('a site that is not on Atlassian is notFound', async () => {
    const connector = jiraConnector(CONNECTION, 'token', async () => json(404, {}))

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'notFound' })
    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: false, failure: 'notFound' })
  })

  test.each([
    ['a 429 (rate limited) is backed off, then', 429, 4],
    ['a 502 (Jira down) is sent once, and', 502, 1],
  ])('%s unavailable', async (_, status, times) => {
    const jira = answeringPastTenant(async () => new Response('Too many requests', { status }))
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, noWait)

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: false, failure: 'unavailable' })
    expect(jira.sent.filter(throughGateway)).toHaveLength(times)
  })

  test('a 403 from Jira is not a rate limit, so it is sent once', async () => {
    const jira = answeringPastTenant(async () => new Response('Forbidden', { status: 403, headers: { 'retry-after': '1' } }))
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'unavailable' })
    expect(jira.sent.filter(throughGateway)).toHaveLength(1)
  })

})

/** What a stand-in Jira lists for milestone choices: its fix versions, and the first page of its epics and labels. */
interface Listing {
  versions?: { id: string; name: string; released: boolean; archived: boolean }[]
  /** The epics the first page of the epics search finds; `moreEpics` when there is another page. */
  epics?: { key: string; summary: string }[]
  moreEpics?: boolean
  /** The labels the first page of the site's labels gives; `moreLabels` when there is another page. */
  labels?: string[]
  moreLabels?: boolean
}

/** A stand-in Jira listing `listing`, past its cloud id. */
function jiraListing(listing: Listing) {
  return answeringPastTenant(async (url) => {
    if (url.endsWith('/project/SYN/versions')) return json(200, listing.versions ?? [])
    if (url.endsWith('/search/jql')) {
      const issues = (listing.epics ?? []).map(({ key, summary }, i) => ({ id: String(20000 + i), key, fields: { summary } }))
      return json(200, listing.moreEpics ? { issues, isLast: false, nextPageToken: 'page-2' } : { issues, isLast: true })
    }
    if (url.includes('/label?')) return json(200, { values: listing.labels ?? [], isLast: !listing.moreLabels })
    return json(404, {})
  })
}

/** The milestone choices from a stand-in Jira listing `listing`. */
async function choicesListing(listing: Listing) {
  const connector = jiraConnector(CONNECTION, 'token', jiraListing(listing).transport, mustNotWait)
  const result = await connector.milestoneChoices()
  if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
  return result.kinds
}

/** `count` things, each made by `make` from its number, counting from 1. */
function many<T>(count: number, make: (n: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i + 1))
}

describe('Jira milestone choices', () => {
  describe('in the space SYN', () => {
    test('come as fix versions, then epics, then labels, none past the limit', async () => {
      const result = await jiraSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds.map(({ kind, pastLimit }) => ({ kind, pastLimit }))).toEqual([
        { kind: 'fixVersion', pastLimit: false },
        { kind: 'epic', pastLimit: false },
        { kind: 'label', pastLimit: false },
      ])
    })

    test('list the epics not done, each read by its children', async () => {
      const result = await jiraSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds[1]!.choices).toEqual([{ kind: 'epic', name: 'Epic: payment methods', query: 'parent = SYN-106' }])
    })

    test('list the labels, each read by its name', async () => {
      const result = await jiraSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds[2]!.choices).toEqual(
        expect.arrayContaining([
          { kind: 'label', name: 'comparable', query: 'labels = "comparable"' },
          { kind: 'label', name: 'ktlo', query: 'labels = "ktlo"' },
        ]),
      )
    })
  })

  test('come as fix versions, then epics, then labels', async () => {
    expect(await choicesListing({})).toEqual([
      { kind: 'fixVersion', choices: [], pastLimit: false },
      { kind: 'epic', choices: [], pastLimit: false },
      { kind: 'label', choices: [], pastLimit: false },
    ])
  })

  test('with more than 100 unreleased fix versions, list 100, marked past the limit', async () => {
    const versions = many(102, (n) => ({ id: String(n), name: `V${n}`, released: n === 1, archived: false }))

    const [fixVersions] = await choicesListing({ versions })

    expect(fixVersions!.choices).toHaveLength(100)
    expect(fixVersions!.choices[0]!.name).toBe('V2')
    expect(fixVersions!.pastLimit).toBe(true)
  })

  test('with exactly 100 unreleased fix versions, list them all, not past the limit', async () => {
    const versions = many(101, (n) => ({ id: String(n), name: `V${n}`, released: false, archived: n === 101 }))

    const [fixVersions] = await choicesListing({ versions })

    expect(fixVersions!.choices).toHaveLength(100)
    expect(fixVersions!.pastLimit).toBe(false)
  })

  test('a fix version is read by its name, quoted, any quote or backslash in it escaped', async () => {
    const [fixVersions] = await choicesListing({ versions: [{ id: '1', name: 'Say "hi" \\ bye', released: false, archived: false }] })

    expect(fixVersions!.choices).toEqual([{ kind: 'fixVersion', name: 'Say "hi" \\ bye', query: 'fixVersion = "Say \\"hi\\" \\\\ bye"' }])
  })

  test('an epic is named by its summary and read by its children, its key naming it', async () => {
    const [, epics] = await choicesListing({ epics: [{ key: 'SYN-7', summary: 'Payments' }] })

    expect(epics!.choices).toEqual([{ kind: 'epic', name: 'Payments', query: 'parent = SYN-7' }])
  })

  test('with a page of epics after the first 100, list 100, marked past the limit', async () => {
    const [, epics] = await choicesListing({ epics: many(100, (n) => ({ key: `SYN-${n}`, summary: `E${n}` })), moreEpics: true })

    expect(epics!.choices).toHaveLength(100)
    expect(epics!.pastLimit).toBe(true)
  })

  test('a label is read by its name, quoted', async () => {
    const [, , labels] = await choicesListing({ labels: ['checkout', 'say"hi'] })

    expect(labels!.choices).toEqual([
      { kind: 'label', name: 'checkout', query: 'labels = "checkout"' },
      { kind: 'label', name: 'say"hi', query: 'labels = "say\\"hi"' },
    ])
  })

  test('with a page of labels after the first 100, list 100, marked past the limit', async () => {
    const [, , labels] = await choicesListing({ labels: many(100, (n) => `l${n}`), moreLabels: true })

    expect(labels!.choices).toHaveLength(100)
    expect(labels!.pastLimit).toBe(true)
  })
})

describe('Jira milestone choices searched past the limit', () => {
  test('a fix version, which Jira gives all at once, is found among the unreleased ones, matching part of a word', async () => {
    const versions = many(150, (n) => ({ id: String(n), name: `Release ${n}`, released: n === 14, archived: n === 140 }))
    const connector = jiraConnector(CONNECTION, 'token', jiraListing({ versions }).transport, mustNotWait)

    const found = await connector.searchChoices('fixVersion', 'ASE 14')

    expect(found).toEqual({
      ok: true,
      choices: ['Release 141', 'Release 142', 'Release 143', 'Release 144', 'Release 145', 'Release 146', 'Release 147', 'Release 148', 'Release 149'].map(
        (name) => ({ kind: 'fixVersion', name, query: `fixVersion = "${name}"` }),
      ),
    })
  })

  test("an epic is searched by the words of its summary, each a word's start, among the epics not done", async () => {
    const asked: unknown[] = []
    const jira = answeringPastTenant(async (_, init) => {
      asked.push(JSON.parse(String(init?.body)))
      return json(200, { issues: [{ id: '20140', key: 'SYN-140', fields: { summary: 'Card payments' } }], isLast: true })
    })
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    expect(await connector.searchChoices('epic', 'card pay"ments*')).toEqual({ ok: true, choices: [{ kind: 'epic', name: 'Card payments', query: 'parent = SYN-140' }] })
    // Search's special characters are left out, so none can make the JQL fail.
    expect(asked).toEqual([
      {
        jql: 'project = "SYN" AND issuetype = Epic AND statusCategory != Done AND summary ~ "card*" AND summary ~ "pay*" AND summary ~ "ments*" ORDER BY created DESC',
        fields: ['summary'],
        maxResults: 100,
      },
    ])
  })

  test("a label is found by JQL's suggestions for the labels field", async () => {
    const jira = answeringPastTenant(async (url) => {
      const { pathname, searchParams } = new URL(url)
      if (pathname.endsWith('/jql/autocompletedata/suggestions') && searchParams.get('fieldName') === 'labels' && searchParams.get('fieldValue') === 'pay') {
        return json(200, { results: [{ value: 'payments', displayName: '<b>pay</b>ments' }, { value: 'pay"day', displayName: '<b>pay</b>"day' }] })
      }
      return json(404, {})
    })
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    expect(await connector.searchChoices('label', 'pay')).toEqual({
      ok: true,
      choices: [
        { kind: 'label', name: 'payments', query: 'labels = "payments"' },
        { kind: 'label', name: 'pay"day', query: 'labels = "pay\\"day"' },
      ],
    })
  })

  test('a search the tracker fails is that failure', async () => {
    const jira = answeringPastTenant(async () => json(502, {}))
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    for (const kind of ['fixVersion', 'epic', 'label']) expect(await connector.searchChoices(kind, 'pay')).toEqual({ ok: false, failure: 'unavailable' })
  })
})
