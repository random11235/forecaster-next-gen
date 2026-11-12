import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Connector } from '../../src/connectors/connector.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { milestoneStepView, submitMilestoneQuery } from '../../src/forecast/milestoneStep.js'
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

/** The local build's means to connect, on the canned connector, counting its calls. */
function connecting(): Connecting & { calls: { choices: number; reads: string[] } } {
  const calls = { choices: 0, reads: [] as string[] }
  const canned = cannedConnector(FIXTURE)
  const connector = (): Connector => ({
    milestoneChoices: () => {
      calls.choices += 1
      return canned.milestoneChoices()
    },
    read: (query, since) => {
      calls.reads.push(query)
      return canned.read(query, since)
    },
  })
  return { connections: storage, reads: storage, milestoneQueries: storage, secrets: openMemorySecrets(), connector, calls }
}

/** Connected to a GitHub repo, with no calls counted yet. */
async function connected(): Promise<ReturnType<typeof connecting>> {
  const using = connecting()
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
        { kind: 'milestone', choices: [payments, checkout] },
        { kind: 'label', choices: [repay, bug] },
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
      { kind: 'milestone', choices: [payments] },
      { kind: 'label', choices: [repay] },
    ])
  })

  test('the browser build, with nothing to connect with, has no Milestone step', async () => {
    expect(await milestoneStepView(undefined, TEAM)).toEqual({ kind: 'noMilestoneStep' })
  })

  test('before connecting, there is no Milestone step', async () => {
    expect(await milestoneStepView(connecting(), TEAM)).toEqual({ kind: 'noMilestoneStep' })
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
        { kind: 'milestone', choices: [checkout] },
        { kind: 'label', choices: [repay] },
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
