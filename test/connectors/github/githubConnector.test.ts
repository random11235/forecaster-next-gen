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
  ])('a query naming %s is outOfScope, with no request made', async (_, query) => {
    // An empty replay throws on any request, so a request made would fail this test.
    const connector = githubConnector(CONNECTION, 'token', replayTransport([]))

    expect(await connector.read(query, '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'outOfScope' })
  })

  test.each([403, 429, 502])('a %s from GitHub (rate limited, or GitHub down) is unavailable', async (status) => {
    const connector = githubConnector(CONNECTION, 'token', async () => new Response('{"message":"rate limited"}', { status }))

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure: 'unavailable' })
    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'unavailable' })
  })
})
