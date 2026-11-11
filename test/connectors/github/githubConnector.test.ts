import { describe, expect, test } from 'vitest'
import { githubConnector } from '../../../src/connectors/github/githubConnector.js'
import { answering, mustNotWait, recordingWait } from '../backoff.js'
import { replayTransport } from '../replayTransport.js'

// GitHub-only quirks, beside the contract suite. Search wraps the query as `repo:… is:issue no:sub-issue (query) (…)`, so a query that
// names another repo, or closes the wrapper's parenthesis, would reach past the connection.

const CONNECTION = { tracker: 'github', owner: 'random11235', repo: 'forecaster-synthetic' } as const

/** A stand-in GitHub whose primary rate limit is spent until `reset`, in seconds since the epoch. */
function primaryRateLimit(reset: string) {
  const headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }
  return answering(async () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers }))
}

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
    expect(searched).toEqual([`repo:random11235/forecaster-synthetic is:issue no:sub-issue (${query}) (is:open OR closed:>=2026-01-01T00:00:00+00:00)`])
  })

  // GitHub rate limits with a 429, or with a 403 that says so in its headers; a 403 without them is a refusal.
  test.each([
    ['a 429', 429, {}, [1000, 2000, 4000]],
    ['a 403 with no requests left', 403, { 'x-ratelimit-remaining': '0' }, [1000, 2000, 4000]],
    ['a 403 asking to retry later', 403, { 'retry-after': '30' }, [30_000, 30_000, 30_000]],
  ])('%s from GitHub is a rate limit, backed off, then unavailable', async (_, status, headers, backoff) => {
    const github = answering(async () => new Response('{"message":"rate limited"}', { status, headers }))
    const { wait, waits } = recordingWait()
    const connector = githubConnector(CONNECTION, 'token', github.transport, wait)

    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'unavailable' })
    expect(waits).toEqual(backoff)
    expect(github.sent).toHaveLength(4)
  })

  test('a primary rate limit (no requests left) waits until its reset, which GitHub gives as an instant, not a retry-after', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 30)
    const { wait, waits } = recordingWait()
    const connector = githubConnector(CONNECTION, 'token', primaryRateLimit(reset).transport, wait)

    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'unavailable' })
    expect(waits).toHaveLength(3)
    for (const each of waits) {
      expect(each).toBeGreaterThan(28_000)
      expect(each).toBeLessThanOrEqual(30_000)
    }
  })

  test.each([
    ['a primary rate limit resetting more than a minute away', () => primaryRateLimit(String(Math.ceil(Date.now() / 1000) + 3600))],
    ['a 403 asking to retry after more than a minute', () => answering(async () => new Response('{"message":"rate limited"}', { status: 403, headers: { 'retry-after': '3600' } }))],
  ])("%s is unavailable at once, so a read doesn't hang", async (_, standIn) => {
    const github = standIn()
    const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure: 'unavailable' })
    expect(github.sent).toHaveLength(1)
  })

  test.each([
    ['a 502 (GitHub down) is unavailable', 502, {}, 'unavailable'],
    ['a 403 that is not a rate limit (the token lacks permission) is unauthorised', 403, { 'x-ratelimit-remaining': '4999' }, 'unauthorised'],
  ])('%s, sent once with no backoff', async (_, status, headers, failure) => {
    const github = answering(async () => new Response('{"message":"Resource not accessible by personal access token"}', { status, headers }))
    const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

    expect(await connector.milestoneChoices()).toEqual({ ok: false, failure })
    expect(await connector.read('label:a', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure })
    expect(github.sent).toHaveLength(2)
  })
})
