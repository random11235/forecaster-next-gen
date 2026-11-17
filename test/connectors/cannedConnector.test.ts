import { describe, expect, test } from 'vitest'
import { cannedConnector, demoConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, Failure } from '../../src/connectors/connector.js'
import type { Connection } from '../../src/model/connection.js'

// The canned connector: what Seam B tests read tickets through, with no tracker, token or network.

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [{ kind: 'milestone', name: 'Launch', query: 'milestone:Launch' }], pastLimit: false },
    { kind: 'label', choices: [{ kind: 'label', name: 'checkout', query: 'label:checkout' }], pastLimit: true },
  ],
  reads: {
    'milestone:Launch': {
      tickets: [{ id: 'T1', finishedAt: '2026-10-20T09:00:00Z' }, { id: 'T2' }],
      incomplete: false,
    },
    'milestone:Beta': {
      tickets: [{ id: 'T3', finishedAt: '2026-09-30T23:59:59Z' }, { id: 'T4', finishedAt: '2026-10-01T00:00:00Z' }, { id: 'T5' }],
      incomplete: true,
    },
  },
}

const FAILURES: Failure[] = [
  { failure: 'invalidQuery', message: "The label 'nope' does not exist." },
  { failure: 'outOfScope' },
  { failure: 'notFound' },
  { failure: 'unauthorised' },
  { failure: 'unavailable' },
]

describe('canned connector', () => {
  test("a read returns its fixture's tickets for that query", async () => {
    const result = await cannedConnector(FIXTURE).read('milestone:Launch', '2026-10-01T00:00:00Z')

    expect(result).toEqual({
      ok: true,
      tickets: [{ id: 'T1', finishedAt: '2026-10-20T09:00:00Z' }, { id: 'T2' }],
      incomplete: false,
    })
  })

  test('a read whose query matches nothing returns an empty list, not a failure', async () => {
    const result = await cannedConnector(FIXTURE).read('milestone:Nothing', '2026-10-01T00:00:00Z')

    expect(result).toEqual({ ok: true, tickets: [], incomplete: false })
  })

  test('a read leaves out tickets finished before the instant given, keeping open ones and its incomplete flag', async () => {
    const result = await cannedConnector(FIXTURE).read('milestone:Beta', '2026-10-01T00:00:00Z')

    expect(result).toEqual({
      ok: true,
      tickets: [{ id: 'T4', finishedAt: '2026-10-01T00:00:00Z' }, { id: 'T5' }],
      incomplete: true,
    })
  })

  test.each(FAILURES)('a read returns $failure on cue', async (failure) => {
    const connector = cannedConnector({ ...FIXTURE, reads: { 'milestone:Launch': failure } })

    expect(await connector.read('milestone:Launch', '2026-10-01T00:00:00Z')).toEqual({ ok: false, ...failure })
  })

  test("milestone choices are the fixture's, one list per kind, each marked whether it is past the limit", async () => {
    expect(await cannedConnector(FIXTURE).milestoneChoices()).toEqual({
      ok: true,
      kinds: [
        { kind: 'milestone', choices: [{ kind: 'milestone', name: 'Launch', query: 'milestone:Launch' }], pastLimit: false },
        { kind: 'label', choices: [{ kind: 'label', name: 'checkout', query: 'label:checkout' }], pastLimit: true },
      ],
    })
  })

  test.each(FAILURES)('milestone choices return $failure on cue', async (failure) => {
    const connector = cannedConnector({ ...FIXTURE, milestoneChoices: failure })

    expect(await connector.milestoneChoices()).toEqual({ ok: false, ...failure })
  })
})

describe("demo mode's connector", () => {
  const REPO: Connection = { tracker: 'github', owner: 'shop-team', repo: 'shop' }
  const PROJECT: Connection = { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' }

  /** Each choice's query reads synthetic tickets. */
  async function expectEachReadsTickets(connector: ReturnType<typeof demoConnector>, choices: Choice[]): Promise<void> {
    for (const choice of choices) {
      const read = await connector.read(choice.query, '2026-01-01T00:00:00Z')
      if (!read.ok) throw new Error(`read of ${choice.query} failed: ${read.failure}`)
      expect(read.tickets.length).toBeGreaterThan(0)
      expect(read.tickets.every((ticket) => ticket.id.startsWith('synthetic-'))).toBe(true)
    }
  }

  test('offers milestones and labels, each of whose queries reads synthetic tickets, and epics past the limit', async () => {
    const connector = demoConnector(REPO, 'any-token')

    const choices = await connector.milestoneChoices()

    if (!choices.ok) throw new Error(`milestone choices failed: ${choices.failure}`)
    expect(choices.kinds.map(({ kind, choices, pastLimit }) => ({ kind, count: choices.length, pastLimit }))).toEqual([
      { kind: 'epic', count: 100, pastLimit: true },
      { kind: 'milestone', count: 3, pastLimit: false },
      { kind: 'label', count: 5, pastLimit: false },
    ])
    // The fixture is JSON, which types no kind: every choice is of its list's kind.
    for (const { kind, choices: ofKind } of choices.kinds) expect(ofKind.map((choice) => choice.kind)).toEqual(ofKind.map(() => kind))
    const listed = choices.kinds.slice(1).flatMap((kind) => kind.choices)
    expect(listed.map((choice) => choice.name)).toEqual([
      'Synthetic launch',
      'Synthetic beta',
      'Payments v2',
      'payments',
      'repayments',
      'checkout',
      'bug',
      'platform',
    ])
    await expectEachReadsTickets(connector, listed)
  })

  test('finds payment epics past the first 100 by search, each reading synthetic tickets', async () => {
    const connector = demoConnector(REPO, 'any-token')

    const found = await connector.searchChoices('epic', 'payment')

    if (!found.ok) throw new Error(`search failed: ${found.failure}`)
    expect(found.choices.map((choice) => choice.name)).toEqual(['Epic: payment methods', 'Epic: card payments'])
    expect(found.choices.map((choice) => choice.kind)).toEqual(['epic', 'epic'])
    await expectEachReadsTickets(connector, found.choices)
  })
})

describe("demo mode's connector, refusing on cue", () => {
  test.each([
    ['the token `refused`', { tracker: 'github', owner: 'shop-team', repo: 'shop' }, 'refused', 'unauthorised'],
    [
      'the token `refused`, on Jira',
      { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example' },
      ' refused ',
      'unauthorised',
    ],
    ['a repo named `unknown`', { tracker: 'github', owner: 'shop-team', repo: 'unknown' }, 'any-token', 'notFound'],
    ['a project named `unknown`', { tracker: 'jira', site: 'shop.atlassian.net', projectKey: 'UNKNOWN', email: 'em@shop.example' }, 'any-token', 'notFound'],
  ] as const)('%s is refused', async (_, connection, token, failure) => {
    expect(await demoConnector(connection, token).milestoneChoices()).toEqual({ ok: false, failure })
    expect(await demoConnector(connection, token).read('milestone:"Synthetic launch"', '2026-01-01T00:00:00Z')).toEqual({ ok: false, failure })
  })
})
