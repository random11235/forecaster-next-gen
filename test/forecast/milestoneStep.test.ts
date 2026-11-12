import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, ChoicesOfKind, Connector } from '../../src/connectors/connector.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { milestoneStepView, searchedChoiceList, submitMilestoneQuery } from '../../src/forecast/milestoneStep.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// The Milestone step (#191): picking the milestone's tickets, joining the picks into the milestone query, and its read.

const TEAM = 'team'
const READ_AT = '2026-11-12T09:00:00Z'

const payments: Choice = { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' }
const checkout: Choice = { kind: 'milestone', name: 'Checkout', query: 'milestone:"Checkout"' }
const repay: Choice = { kind: 'label', name: 'repayments', query: 'label:"repayments"' }
const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [payments, checkout], pastLimit: false },
    { kind: 'label', choices: [repay, bug], pastLimit: false },
  ],
  reads: {
    'milestone:"Payments v2"': {
      tickets: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'p4', finishedAt: '2026-08-01T10:00:00Z' }],
      incomplete: false,
    },
    'milestone:"Payments v2" OR label:"bug"': {
      tickets: [{ id: 'p1' }, { id: 'p2' }, { id: 'b1' }, { id: 'p3', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'b2', finishedAt: '2026-11-01T10:00:00Z' }],
      incomplete: false,
    },
  },
}

let dir: string
let file: string
let storage: SqliteStorage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-milestone-step-'))
  file = join(dir, 'forecaster.db')
  storage = openSqliteStorage(file)
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

/** The local build's means to connect, on the canned connector answering from `fixture`, counting its calls. */
function connecting(fixture: CannedFixture = FIXTURE): Connecting & { calls: { choices: number; reads: string[]; searches: [string, string][] } } {
  const calls = { choices: 0, reads: [] as string[], searches: [] as [string, string][] }
  const canned = cannedConnector(fixture)
  const connector = (): Connector => ({
    milestoneChoices: () => {
      calls.choices += 1
      return canned.milestoneChoices()
    },
    searchChoices: (kind, text) => {
      calls.searches.push([kind, text])
      return canned.searchChoices(kind, text)
    },
    read: (query, since) => {
      calls.reads.push(query)
      return canned.read(query, since)
    },
  })
  return { connections: storage, reads: storage, milestoneQueries: storage, secrets: openMemorySecrets(), connector, calls }
}

/** Connected to a GitHub repo, with no calls counted yet. */
async function connected(fixture: CannedFixture = FIXTURE): Promise<ReturnType<typeof connecting>> {
  const using = connecting(fixture)
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
  using.calls.choices = 0
  return using
}

const add = (choice: Choice) => ({ kind: 'addPick', choice }) as const
const remove = (choice: Choice) => ({ kind: 'removePick', query: choice.query }) as const

describe('opening the Milestone step', () => {
  test('lists the choices by kind, asking for them once, with nothing picked and no read', async () => {
    const using = await connected()

    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.choices).toBe(1)
    expect(using.calls.reads).toEqual([])
    expect(view).toEqual({
      kind: 'milestoneStep',
      find: '',
      lists: [
        { kind: 'milestone', choices: [payments, checkout], searched: false },
        { kind: 'label', choices: [repay, bug], searched: false },
      ],
      picks: [],
      query: '',
      note: 'Leaf tickets only. Epics include their sub-epics.',
    })
  })

  test('filters the lists by what is typed, ignoring case and matching part of a word', async () => {
    const using = await connected()

    const view = await milestoneStepView(using, TEAM, 'PAY')

    expect(view.kind === 'milestoneStep' && view.lists).toEqual([
      { kind: 'milestone', choices: [payments], searched: false },
      { kind: 'label', choices: [repay], searched: false },
    ])
  })

  test('the browser build, with nothing to connect with, has no Milestone step', async () => {
    expect(await milestoneStepView(undefined, TEAM)).toEqual({ kind: 'noMilestoneStep' })
  })

  test('before connecting, there is no Milestone step', async () => {
    expect(await milestoneStepView(connecting(), TEAM)).toEqual({ kind: 'noMilestoneStep' })
  })
})

describe('a kind with more than 100 entries', () => {
  const epic = (n: number): Choice => ({ kind: 'epic', name: `Epic ${n}`, query: `parent-issue:shop-team/shop#${n}` })
  const listed = Array.from({ length: 100 }, (_, i) => epic(i + 1))
  const cardPayments: Choice = { kind: 'epic', name: 'Card payments', query: 'parent-issue:shop-team/shop#140' }
  const payouts: Choice = { kind: 'epic', name: 'Payouts', query: 'parent-issue:shop-team/shop#141' }

  /** 120 epics, past the limit, the first 100 listed; and the milestones and labels in full. */
  const PAST_LIMIT: CannedFixture = {
    ...FIXTURE,
    milestoneChoices: [
      { kind: 'epic', choices: listed, pastLimit: true },
      ...(FIXTURE.milestoneChoices as ChoicesOfKind[]),
    ],
    searched: { epic: [...listed, cardPayments, payouts, ...Array.from({ length: 18 }, (_, i) => epic(142 + i))] },
  }

  test('is searched in the tracker for what is typed, while the other kinds are filtered here', async () => {
    const using = await connected(PAST_LIMIT)

    const view = await milestoneStepView(using, TEAM, ' Payments ')

    expect(using.calls.searches).toEqual([['epic', 'Payments']])
    expect(view.kind === 'milestoneStep' && view.lists).toEqual([
      { kind: 'epic', choices: [cardPayments], searched: true },
      { kind: 'milestone', choices: [payments], searched: false },
      { kind: 'label', choices: [repay], searched: false },
    ])
  })

  test('with nothing typed, lists the first 100, searching nothing', async () => {
    const using = await connected(PAST_LIMIT)

    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.searches).toEqual([])
    expect(view.kind === 'milestoneStep' && view.lists[0]).toEqual({ kind: 'epic', choices: listed, searched: true })
  })

  test('leaves out of what the tracker finds the choices already picked', async () => {
    const using = await connected(PAST_LIMIT)
    await submitMilestoneQuery(using, TEAM, add(cardPayments), READ_AT)

    const view = await milestoneStepView(using, TEAM, 'payments')

    expect(view.kind === 'milestoneStep' && view.lists[0]).toEqual({ kind: 'epic', choices: [], searched: true })
  })

  test('says so when the tracker can’t search, still listing the other kinds', async () => {
    const using = await connected({ ...PAST_LIMIT, searched: { epic: { failure: 'unavailable' } } })

    const view = await milestoneStepView(using, TEAM, 'pay')

    expect(view.kind === 'milestoneStep' && view.choicesFailure).toBeUndefined()
    expect(view).toMatchObject({
      lists: [
        { kind: 'epic', choices: [], searched: true, failure: 'The tracker couldn’t search its epics just now. Try again in a few minutes.' },
        { kind: 'milestone', choices: [payments], searched: false },
        { kind: 'label', choices: [repay], searched: false },
      ],
    })
  })

  test('one kind searched on its own, as the picker asks for it while the EM types', async () => {
    const using = await connected(PAST_LIMIT)

    expect(await searchedChoiceList(using, TEAM, 'epic', 'payouts')).toEqual({ kind: 'epic', choices: [payouts], searched: true })
    expect(using.calls.choices).toBe(0)
  })
})

describe('picking', () => {
  test('a pick becomes a chip, and the milestone query, read once, showing its line', async () => {
    const using = await connected()

    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 8 weeks' })
  })

  test('picks are joined with OR into one query, read once for the lot, and leave the lists', async () => {
    const using = await connected()

    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)
    await submitMilestoneQuery(using, TEAM, add(bug), READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"', 'milestone:"Payments v2" OR label:"bug"'])
    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 8 weeks',
      lists: [
        { kind: 'milestone', choices: [checkout], searched: false },
        { kind: 'label', choices: [repay], searched: false },
      ],
    })
  })

  test('removing a chip takes its query out and reads the rest again', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)
    await submitMilestoneQuery(using, TEAM, add(bug), READ_AT)

    await submitMilestoneQuery(using, TEAM, remove(bug), READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads.at(-1)).toBe('milestone:"Payments v2"')
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 8 weeks' })
  })

  test('removing the last chip leaves no query, and nothing to read', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    await submitMilestoneQuery(using, TEAM, remove(payments), READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind === 'milestoneStep' && view.read).toBeUndefined()
  })

  test('picking what is already picked changes nothing and reads nothing', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('the picks and query are saved, and still there after a restart', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)
    await submitMilestoneQuery(using, TEAM, add(bug), READ_AT)
    storage.close()

    storage = openSqliteStorage(file)
    const view = await milestoneStepView({ ...using, connections: storage, reads: storage, milestoneQueries: storage }, TEAM)

    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 8 weeks',
    })
  })

  test('opening the step reads nothing: the line is the query’s saved read', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    await milestoneStepView(using, TEAM)
    await milestoneStepView(using, TEAM, 'pay')

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
  })
})
