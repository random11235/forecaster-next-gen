import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { githubConnector } from '../../../src/connectors/github/githubConnector.js'
import { answering, mustNotWait, recordingWait } from '../backoff.js'
import { replayTransport } from '../replayTransport.js'
import { FROM_THE_START, GITHUB_QUIRKS } from '../scenarios.js'
import { githubSubject } from './githubSubject.js'

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

  describe('milestone choices', () => {
    test("come as the repo's epics, labels and milestones, in that order, each with the query that reads its tickets", async () => {
      const result = await githubSubject.synthetic().milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      expect(result.kinds.map(({ kind, pastLimit }) => ({ kind, pastLimit }))).toEqual([
        { kind: 'epic', pastLimit: false },
        { kind: 'label', pastLimit: false },
        { kind: 'milestone', pastLimit: false },
      ])
      const [epics, labels] = result.kinds
      // #106 is the top-level epic; its sub-epic #107 is picked through it, so isn't listed. Short forms of
      // `parent-issue:` match nothing, with no error, so the repo is named in full.
      expect(epics!.choices).toEqual([{ kind: 'epic', name: 'Epic: payment methods', query: 'parent-issue:random11235/forecaster-synthetic#106' }])
      expect(labels!.choices).toHaveLength(13)
      expect(labels!.choices).toContainEqual({ kind: 'label', name: 'good first issue', query: 'label:"good first issue"' })
      expect(labels!.choices).toContainEqual({ kind: 'label', name: 'comparable', query: 'label:"comparable"' })
    })

    /** How many of each kind a stand-in GitHub has. */
    type Counts = Record<'epic' | 'label' | 'milestone', number>

    /**
     * A stand-in GitHub with `counts` top-level epics, labels and open milestones: its REST API pages the labels and
     * milestones, and its search gives one page of epics with the count of all it found.
     */
    function withChoices(counts: Counts) {
      return answering(async (url) => {
        const { pathname, searchParams } = new URL(url)
        const perPage = Number(searchParams.get('per_page') ?? 30)
        const page = Number(searchParams.get('page') ?? 1)
        const paged = (count: number, prefix: string) =>
          Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).slice((page - 1) * perPage, page * perPage)
        if (pathname.endsWith('/search/issues')) {
          const items = paged(counts.epic, 'E').map((title, i) => ({ node_id: `I_${i}`, number: 1000 + i, title, state: 'open', closed_at: null }))
          return new Response(JSON.stringify({ total_count: counts.epic, incomplete_results: false, items }), { status: 200 })
        }
        if (pathname.endsWith('/labels')) return new Response(JSON.stringify(paged(counts.label, 'L').map((name) => ({ name }))), { status: 200 })
        return new Response(JSON.stringify(paged(counts.milestone, 'M').map((title) => ({ title }))), { status: 200 })
      })
    }

    test.each([
      ['epic', { epic: 101, label: 3, milestone: 3 }],
      ['label', { epic: 3, label: 101, milestone: 3 }],
      ['milestone', { epic: 3, label: 3, milestone: 101 }],
    ] as const)('with more than 100 of a kind (%s), list 100 of it, marked past the limit, and the others in full', async (kind, counts) => {
      const connector = githubConnector(CONNECTION, 'token', withChoices(counts).transport, mustNotWait)

      const result = await connector.milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      for (const each of result.kinds) {
        expect(each.choices).toHaveLength(each.kind === kind ? 100 : 3)
        expect(each.pastLimit).toBe(each.kind === kind)
      }
    })

    describe('searched past the limit', () => {
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

      test('an epic is searched by the words of its title, among the top-level epics, each word quoted', async () => {
        const searched: string[] = []
        const github = answering(async (url) => {
          searched.push(new URL(url).searchParams.get('q')!)
          const items = [{ node_id: 'I_140', number: 140, title: 'Card payments', state: 'open', closed_at: null }]
          return json({ total_count: 1, incomplete_results: false, items })
        })
        const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

        expect(await connector.searchChoices('epic', 'card "payments')).toEqual({
          ok: true,
          choices: [{ kind: 'epic', name: 'Card payments', query: 'parent-issue:random11235/forecaster-synthetic#140' }],
        })
        expect(searched).toEqual(['repo:random11235/forecaster-synthetic is:issue is:open has:sub-issue no:parent-issue in:title "card" "payments"'])
        expect(github.sent[0]).toContain('advanced_search=true')
      })

      test("a label is found by search's label search, in the repo by its id", async () => {
        const github = answering(async (url) => {
          const { pathname, searchParams } = new URL(url)
          if (pathname === '/repos/random11235/forecaster-synthetic') return json({ id: 1234 })
          if (pathname === '/search/labels' && searchParams.get('repository_id') === '1234' && searchParams.get('q') === 'pay') {
            return json({ total_count: 2, incomplete_results: false, items: [{ name: 'payments' }, { name: 'pay day' }] })
          }
          return json({ message: 'Not Found' }, 404)
        })
        const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

        expect(await connector.searchChoices('label', 'pay')).toEqual({
          ok: true,
          choices: [
            { kind: 'label', name: 'payments', query: 'label:"payments"' },
            { kind: 'label', name: 'pay day', query: 'label:"pay day"' },
          ],
        })
        // The repo's id is looked up once.
        await connector.searchChoices('label', 'pay')
        expect(github.sent.filter((url) => url.endsWith('/repos/random11235/forecaster-synthetic'))).toHaveLength(1)
      })

      test('a milestone, which GitHub has no search for, is found among every page of open milestones, matching part of a word', async () => {
        const connector = githubConnector(CONNECTION, 'token', withChoices({ epic: 0, label: 0, milestone: 250 }).transport, mustNotWait)

        const found = await connector.searchChoices('milestone', 'm24')

        expect(found).toEqual({
          ok: true,
          choices: ['M24', ...Array.from({ length: 10 }, (_, i) => `M24${i}`)].map((name) => ({ kind: 'milestone', name, query: `milestone:"${name}"` })),
        })
      })

      test('a search the tracker fails is that failure', async () => {
        const github = answering(async () => json({ message: 'Server Error' }, 502))
        const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

        for (const kind of ['epic', 'label', 'milestone'] as const) expect(await connector.searchChoices(kind, 'pay')).toEqual({ ok: false, failure: 'unavailable' })
      })
    })

    test('with exactly 100 of each kind, list them all, none past the limit', async () => {
      const connector = githubConnector(CONNECTION, 'token', withChoices({ epic: 100, label: 100, milestone: 100 }).transport, mustNotWait)

      const result = await connector.milestoneChoices()

      if (!result.ok) throw new Error(`milestone choices failed: ${result.failure}`)
      const hundred = (prefix: string) => Array.from({ length: 100 }, (_, i) => `${prefix}${i + 1}`)
      expect(result.kinds.map(({ kind, choices, pastLimit }) => ({ kind, names: choices.map((choice) => choice.name), pastLimit }))).toEqual([
        { kind: 'epic', names: hundred('E'), pastLimit: false },
        { kind: 'label', names: hundred('L'), pastLimit: false },
        { kind: 'milestone', names: hundred('M'), pastLimit: false },
      ])
    })
  })

  describe('a picked epic', () => {
    const REPO = 'random11235/forecaster-synthetic'

    /**
     * A stand-in GitHub whose issues are nested as `children` says (an issue's sub-issues by its number), searched as
     * GitHub does: `has:sub-issue` finds the named parents' children that have children of their own, and `no:sub-issue`
     * those that don't. `searched` keeps each search's query.
     */
    function nested(children: Map<number, number[]>) {
      const searched: string[] = []
      const transport: Transport = async (url) => {
        const q = new URL(url).searchParams.get('q')!
        searched.push(q)
        const parents = [...q.matchAll(/parent-issue:random11235\/forecaster-synthetic#(\d+)/g)].map((match) => Number(match[1]))
        const epics = q.includes('has:sub-issue')
        const items = parents.flatMap((parent) =>
          (children.get(parent) ?? [])
            .filter((child) => (children.get(child)?.length ?? 0) > 0 === epics)
            .map((child) => ({
              node_id: `I_${child}`,
              number: child,
              title: `#${child}`,
              state: 'open',
              closed_at: null,
              parent_issue_url: `https://api.github.com/repos/${REPO}/issues/${parent}`,
            })),
        )
        return new Response(JSON.stringify({ total_count: items.length, incomplete_results: false, items }), { status: 200 })
      }
      return { transport, searched }
    }

    test('picks up, on a later read, a sub-epic added since the last', async () => {
      const children = new Map([[106, [111]]])
      const connector = githubConnector(CONNECTION, 'token', nested(children).transport, mustNotWait)
      const query = `parent-issue:${REPO}#106`

      expect(await connector.read(query, FROM_THE_START)).toEqual({ ok: true, tickets: [{ id: 'I_111' }], incomplete: false })

      children.set(106, [107, 111]).set(107, [108, 109])

      const later = await connector.read(query, FROM_THE_START)
      expect(later.ok && later.tickets.map((ticket) => ticket.id).sort()).toEqual(['I_108', 'I_109', 'I_111'])
    })

    test('reads the leaves of each picked epic in its place in the query, leaving the rest as written', async () => {
      const github = nested(new Map([[106, [107, 111]], [107, [108]], [200, [201]]]))
      const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

      await connector.read(`(parent-issue:${REPO}#106 label:"checkout") OR parent-issue:${REPO}#200`, '2026-01-01T00:00:00Z')

      expect(github.searched.at(-1)).toBe(
        `repo:${REPO} is:issue no:sub-issue (((parent-issue:${REPO}#106 OR parent-issue:${REPO}#107) label:"checkout") OR parent-issue:${REPO}#200) (is:open OR closed:>=2026-01-01T00:00:00+00:00)`,
      )
    })

    test('looks for sub-epics at most 8 levels down, as deep as GitHub nests sub-issues', async () => {
      // A chain of epics 12 deep, each the only sub-issue of the one above.
      const chain = new Map(Array.from({ length: 12 }, (_, k) => [1 + k, [2 + k]] as [number, number[]]))
      const github = nested(chain)
      const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

      await connector.read(`parent-issue:${REPO}#1`, FROM_THE_START)

      expect(github.searched.filter((q) => q.includes('has:sub-issue'))).toHaveLength(8)
    })

    test('a query naming no epic is read with no search for sub-epics', async () => {
      const github = nested(new Map())
      const connector = githubConnector(CONNECTION, 'token', github.transport, mustNotWait)

      await connector.read('label:"checkout"', FROM_THE_START)

      expect(github.searched).toHaveLength(1)
    })

    test("in parent-issue:'s short form matches nothing, with no error, as GitHub's own search does", async () => {
      expect(await githubSubject.synthetic().read(GITHUB_QUIRKS.shortFormEpic, FROM_THE_START)).toEqual({ ok: true, tickets: [], incomplete: false })
    })
  })
})
