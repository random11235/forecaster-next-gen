import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { jiraConnector } from '../../../src/connectors/jira/jiraConnector.js'
import { replayTransport } from '../replayTransport.js'

// Jira-only quirks, beside the contract suite. A read's JQL is wrapped as `project = "KEY" AND (query)`, so a query
// naming a project, or closing the wrapper's parenthesis, would reach past the connection. Jira's timestamps carry the
// token user's offset, and its API is reached through Atlassian's gateway, by the site's cloud id.

const CONNECTION = { tracker: 'jira', site: 'example.atlassian.net', projectKey: 'SYN', email: 'someone@example.com' } as const
const SINCE = '2026-01-01T00:00:00Z'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A stand-in Jira whose search finds `issues`. */
function jiraFinding(issues: unknown[]): Transport {
  return async (url) => {
    if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
    return json(200, { issues, isLast: true })
  }
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
    const searched: string[] = []
    const connector = jiraConnector(CONNECTION, 'token', async (url, init) => {
      if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
      if (url.endsWith('/search/jql')) searched.push((JSON.parse(String(init?.body)) as { jql: string }).jql)
      return json(200, { issues: [{ id: '1', fields: { status: { statusCategory: { key: 'new' } } } }], isLast: true })
    })

    expect(await connector.read(query, SINCE)).toEqual({ ok: true, tickets: [{ id: '1' }], incomplete: false })
    expect(searched).toEqual([`project = "SYN" AND (${query})`])
  })

  test("a finished ticket's finish is a UTC instant, though Jira gives it in the token user's offset", async () => {
    const connector = jiraConnector(
      CONNECTION,
      'token',
      jiraFinding([{ id: '10133', fields: { status: { statusCategory: { key: 'done' } }, statuscategorychangedate: '2026-11-07T18:20:31.412+1100' } }]),
    )

    expect(await connector.read('labels = a', SINCE)).toEqual({
      ok: true,
      tickets: [{ id: '10133', finishedAt: '2026-11-07T07:20:31.412Z' }],
      incomplete: false,
    })
  })

  test('a ticket finished before finishedSince is left out; an open one is kept, however long ago it last moved', async () => {
    const connector = jiraConnector(
      CONNECTION,
      'token',
      jiraFinding([
        { id: '1', fields: { status: { statusCategory: { key: 'done' } }, statuscategorychangedate: '2025-12-31T23:59:59.000+0000' } },
        { id: '2', fields: { status: { statusCategory: { key: 'indeterminate' } }, statuscategorychangedate: '2025-06-01T00:00:00.000+0000' } },
      ]),
    )

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: true, tickets: [{ id: '2' }], incomplete: false })
  })

  test('a search with more pages to come is incomplete', async () => {
    const connector = jiraConnector(CONNECTION, 'token', async (url) =>
      url.endsWith('/_edge/tenant_info') ? json(200, { cloudId: 'cloud-1' }) : json(200, { issues: [], nextPageToken: 'next', isLast: false }),
    )

    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: true, tickets: [], incomplete: true })
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

  test.each([429, 502])('a %s from Jira (rate limited, or Jira down) is unavailable', async (status) => {
    const connector = jiraConnector(CONNECTION, 'token', async (url) =>
      url.endsWith('/_edge/tenant_info') ? json(200, { cloudId: 'cloud-1' }) : new Response('Too many requests', { status }),
    )

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'unavailable' })
    expect(await connector.read('labels = a', SINCE)).toEqual({ ok: false, failure: 'unavailable' })
  })
})
