import { describe, expect, test } from 'vitest'
import { githubConnector } from '../../../src/connectors/github/githubConnector.js'
import { replayTransport } from '../replayTransport.js'

// GitHub-only quirks, beside the contract suite. Search wraps the query as `repo:… is:issue (query)`, so a query that
// names another repo, or closes the wrapper's parenthesis, would reach past the connection.

const CONNECTION = { tracker: 'github', owner: 'random11235', repo: 'forecaster-synthetic' } as const

describe('GitHub connector', () => {
  test.each([
    ['another repo', 'repo:someone/else'],
    ['an organisation', 'is:open org:someone'],
    ['a user', '(label:a OR user:someone)'],
    ['an owner, excluded', '-owner:someone'],
    ['a closing parenthesis that escapes the wrapper', 'label:a) OR (label:b'],
    ['a closing parenthesis between quoted values', 'label:"a") OR (label:"b"'],
  ])('a query naming %s is outOfScope, with no request made', async (_, query) => {
    // An empty replay throws on any request, so a request made would fail this test.
    const connector = githubConnector(CONNECTION, 'token', replayTransport([]))

    expect(await connector.read(query, '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'outOfScope' })
  })

  test.each([
    ['a closing parenthesis in quotes', 'label:"a)"'],
    ['quoted parentheses either way round', 'label:")" OR label:"wip (old"'],
  ])('a query with %s stays in scope and is searched', async (_, query) => {
    const searched: string[] = []
    const connector = githubConnector(CONNECTION, 'token', async (url) => {
      searched.push(new URL(url).searchParams.get('q')!)
      return new Response(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), { status: 200 })
    })

    expect(await connector.read(query, '2026-01-01T00:00:00Z')).toEqual({ ok: true, tickets: [], incomplete: false })
    expect(searched).toEqual([`repo:random11235/forecaster-synthetic is:issue (${query})`])
  })

  // GitHub rate limits with a 429, or with a 403 that says so in its headers; a 403 without them is a refusal.
  test.each([
    ['a 429', 429, {}],
    ['a 403 with no requests left', 403, { 'x-ratelimit-remaining': '0' }],
    ['a 403 asking to retry later', 403, { 'retry-after': '60' }],
    ['a 502', 502, {}],
  ])('%s from GitHub (rate limited, or GitHub down) is unavailable', async (_, status, headers) => {
    const connector = githubConnector(CONNECTION, 'token', async () => new Response('{"message":"rate limited"}', { status, headers }))

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'unavailable' })
    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'unavailable' })
  })

  test('a 403 from GitHub that is not a rate limit (the token lacks permission) is unauthorised', async () => {
    const connector = githubConnector(
      CONNECTION,
      'token',
      async () =>
        new Response('{"message":"Resource not accessible by personal access token"}', { status: 403, headers: { 'x-ratelimit-remaining': '4999' } }),
    )

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'unauthorised' })
    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'unauthorised' })
  })
})
