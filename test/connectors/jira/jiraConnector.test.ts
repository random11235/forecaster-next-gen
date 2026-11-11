import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { jiraConnector } from '../../../src/connectors/jira/jiraConnector.js'
import { replayTransport } from '../replayTransport.js'

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

/** One status change in a changelog, at `at`, as bulk fetch gives it: in milliseconds since the epoch. */
function statusChange(at: string): unknown {
  return { created: Date.parse(at), items: [{ fieldId: 'status' }] }
}

/**
 * A stand-in Jira whose search finds `issues`, one page, and whose bulk fetch gives each ticket the changelog in
 * `changelogs`, keyed by id. `searched` and `fetched` collect what was asked of each.
 */
function jiraFinding(issues: unknown[], changelogs: Record<string, unknown[]> = {}) {
  const searched: { jql: string; nextPageToken?: string }[] = []
  const fetched: string[][] = []
  const transport: Transport = async (url, init) => {
    if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
    const body = JSON.parse(String(init?.body)) as { jql: string; issueIdsOrKeys: string[] }
    if (url.endsWith('/search/jql')) {
      searched.push(body)
      return json(200, { issues, isLast: true })
    }
    fetched.push(body.issueIdsOrKeys)
    return json(200, {
      issueChangeLogs: body.issueIdsOrKeys.map((id) => ({ issueId: id, changeHistories: changelogs[id] ?? [] })),
    })
  }
  return { transport, searched, fetched }
}

describe('Jira connector', () => {
  test("signs in as the connection's account email with the token, which holds no email of its own", async () => {
    const sent: (string | null)[] = []
    const connector = jiraConnector(CONNECTION, 'ATATT-token', async (url, init) => {
      if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
      sent.push(new Headers(init?.headers).get('authorization'))
      return json(200, [])
    })

    expect(await connector.milestoneChoices()).toEqual({ ok: true, choices: [] })
    expect(sent).toEqual([`Basic ${btoa('someone@example.com:ATATT-token')}`])
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
    expect(searched).toHaveLength(1)
    expect(searched[0]!.jql.startsWith(`project = "SYN" AND (${query}) AND (`)).toBe(true)
  })

  test("finishedSince goes into JQL a day early, so it isn't late in the token user's time zone, whichever that is", async () => {
    // JQL reads date literals in the token user's time zone, which a read-only token can't look up; time zones run
    // from 12 hours behind UTC to 14 ahead, so a day before finishedSince, read in any of them, is before it.
    const { transport, searched } = jiraFinding([issue('1')])
    const connector = jiraConnector(CONNECTION, 'token', transport)

    await connector.read('labels = a', '2026-01-01T05:30:45Z')

    expect(searched.map(({ jql }) => jql)).toEqual([
      'project = "SYN" AND (labels = a) AND (statusCategory != Done OR status CHANGED AFTER "2025-12-31 05:30")',
    ])
  })

  test('the day early is read but compared as instants: a ticket finished before finishedSince is left out', async () => {
    const { transport } = jiraFinding([issue('early', 'done'), issue('onTime', 'done'), issue('open', 'indeterminate')], {
      early: [statusChange('2026-01-01T05:30:44Z')],
      onTime: [statusChange('2026-01-01T05:30:45Z')],
      open: [statusChange('2025-06-01T00:00:00Z')],
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
      '1': [statusChange('2026-03-03T00:00:00Z'), statusChange('2026-03-02T00:00:00Z'), statusChange('2026-03-01T00:00:00Z')],
    })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: true, tickets: [{ id: '1', finishedAt: '2026-03-03T00:00:00.000Z' }], incomplete: false })
  })

  test("changelogs are fetched for finished tickets only, up to 1,000 tickets a call", async () => {
    const finished = Array.from({ length: 1500 }, (_, k) => String(k + 1))
    const { transport, fetched } = jiraFinding([...finished.map((id) => issue(id, 'done')), issue('open')], {})
    const connector = jiraConnector(CONNECTION, 'token', transport)

    await connector.read('labels = a', SINCE)

    expect(fetched).toEqual([finished.slice(0, 1000), finished.slice(1000)])
  })

  test('every page of a changelog fetch is read', async () => {
    const pages = [
      { issueChangeLogs: [{ issueId: '1', changeHistories: [statusChange('2026-03-01T00:00:00Z')] }], nextPageToken: 'more' },
      { issueChangeLogs: [{ issueId: '1', changeHistories: [statusChange('2026-03-05T00:00:00Z')] }] },
    ]
    const connector = jiraConnector(CONNECTION, 'token', async (url, init) => {
      if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
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
    const { transport } = jiraFinding([story, subtask], { 'sub-1': [statusChange('2026-03-01T00:00:00Z')] })
    const connector = jiraConnector(CONNECTION, 'token', transport)

    expect(await connector.read('labels = a', SINCE)).toEqual({
      ok: true,
      tickets: [{ id: 'sub-1', finishedAt: '2026-03-01T00:00:00.000Z' }, { id: 'sub-2' }],
      incomplete: false,
    })
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
    let sent = 0
    const connector = jiraConnector(
      CONNECTION,
      'token',
      async (url) => {
        if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
        sent++
        return new Response('Too many requests', { status })
      },
      async () => {},
    )

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: false, failure: 'unavailable' })
    expect(sent).toBe(times)
  })

  test('a 403 from Jira is not a rate limit, so it is sent once', async () => {
    let sent = 0
    const connector = jiraConnector(
      CONNECTION,
      'token',
      async (url) => {
        if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
        sent++
        return new Response('Forbidden', { status: 403, headers: { 'retry-after': '1' } })
      },
      async () => {},
    )

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'unavailable' })
    expect(sent).toBe(1)
  })
})
