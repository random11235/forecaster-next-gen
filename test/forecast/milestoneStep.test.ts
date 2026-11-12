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
    'label:checkout -label:bug': { tickets: [{ id: 'c1' }], incomplete: false },
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

const edit = (query: string) => ({ kind: 'editQuery', query }) as const

describe('editing as a query', () => {
  test('a hand-edited query is saved as written and read once, when submitted', async () => {
    const using = await connected()

    await submitMilestoneQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(view).toMatchObject({ picks: [], query: 'label:checkout -label:bug', read: '1 open · 0 finished in the last 8 weeks' })
  })

  test('Edit as a query opens the milestone query for editing, read within the connected repo', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    const view = await milestoneStepView(using, TEAM, '', { editing: true })

    expect(view.kind === 'milestoneStep' && view.editing).toEqual({ typed: 'milestone:"Payments v2"', readIn: 'shop-team/shop' })
  })

  test('the step opens on finding, not editing, until asked', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    const view = await milestoneStepView(using, TEAM)

    expect(view.kind === 'milestoneStep' && view.editing).toBeUndefined()
  })

  test('a query the picker can’t show stays open for editing, warning that going back to finding clears it', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    const view = await milestoneStepView(using, TEAM)

    expect(view.kind === 'milestoneStep' && view.editing).toEqual({
      typed: 'label:checkout -label:bug',
      readIn: 'shop-team/shop',
      backClears: 'The picker can’t show this query, so going back to finding clears it.',
    })
  })

  test('a hand-edited query that is an OR of choices’ queries comes back as their chips, with no warning', async () => {
    const using = await connected()

    await submitMilestoneQuery(using, TEAM, edit('label:"bug" OR milestone:"Payments v2"'), READ_AT)
    const editing = await milestoneStepView(using, TEAM, '', { editing: true })
    const finding = await milestoneStepView(using, TEAM)

    expect(editing.kind === 'milestoneStep' && editing.editing).toEqual({ typed: 'label:"bug" OR milestone:"Payments v2"', readIn: 'shop-team/shop' })
    expect(finding).toMatchObject({
      picks: [bug, payments],
      query: 'label:"bug" OR milestone:"Payments v2"',
      lists: [
        { kind: 'milestone', choices: [checkout] },
        { kind: 'label', choices: [repay] },
      ],
    })
    expect(finding.kind === 'milestoneStep' && finding.editing).toBeUndefined()
  })
})

describe('a hand-edited query refused before reading', () => {
  test('free text is refused: nothing is saved or read, and the query stays as typed, with why', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    const submitted = await submitMilestoneQuery(using, TEAM, edit('label:checkout payments'), READ_AT)
    const view = submitted?.kind === 'refused' && (await milestoneStepView(using, TEAM, '', { refused: submitted }))

    const refusal = '“payments” is free text, which isn’t read. Pick tickets by epic, label or milestone, such as label:"checkout".'
    expect(submitted).toEqual({ kind: 'refused', query: 'label:checkout payments', refusal })
    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({
      query: 'milestone:"Payments v2"',
      editing: { typed: 'label:checkout payments', readIn: 'shop-team/shop', refusal },
    })
  })

  test.each([
    ['a quoted phrase', '"payment methods"', '“"payment methods"” is free text'],
    ['a word beside an OR', 'label:checkout OR payments', '“payments” is free text'],
  ])('free text as %s is refused', async (_, query, says) => {
    const using = await connected()

    const submitted = await submitMilestoneQuery(using, TEAM, edit(query), READ_AT)

    expect(submitted?.kind === 'refused' && submitted.refusal).toContain(says)
    expect(using.calls.reads).toEqual([])
  })

  test.each([['label:'], ['label:""'], ['milestone:"Payments v2" OR -label:']])('an empty qualifier is refused: %s', async (query) => {
    const using = await connected()

    const submitted = await submitMilestoneQuery(using, TEAM, edit(query), READ_AT)

    expect(submitted?.kind === 'refused' && submitted.refusal).toBe('label: names nothing. Give it one, such as label:"checkout".')
    expect(using.calls.reads).toEqual([])
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
  })

  test('a mistyped qualifier the tracker accepts is read as written, unflagged', async () => {
    const using = await connected()

    const submitted = await submitMilestoneQuery(using, TEAM, edit('lable:checkout'), READ_AT)

    expect(submitted?.kind).toBe('saved')
    expect(using.calls.reads).toEqual(['lable:checkout'])
  })

  test('on Jira, a text search and an empty value are refused; a clause with a value is read', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' })

    const text = await submitMilestoneQuery(using, TEAM, edit('labels = "checkout" OR text ~ "payments"'), READ_AT)
    const empty = await submitMilestoneQuery(using, TEAM, edit('labels = '), READ_AT)
    const emptyQuoted = await submitMilestoneQuery(using, TEAM, edit('fixVersion = "" AND labels = "checkout"'), READ_AT)
    const fine = await submitMilestoneQuery(using, TEAM, edit('labels = "checkout" AND status != Done'), READ_AT)

    expect(text).toEqual({
      kind: 'refused',
      query: 'labels = "checkout" OR text ~ "payments"',
      refusal: '“text ~ "payments"” searches free text, which isn’t read. Pick tickets by fix version, epic or label, such as labels = "checkout".',
    })
    expect(empty?.kind === 'refused' && empty.refusal).toBe('labels = names nothing. Give it one, such as labels = "checkout".')
    expect(emptyQuoted?.kind === 'refused' && emptyQuoted.refusal).toBe('fixVersion = names nothing. Give it one, such as labels = "checkout".')
    expect(fine?.kind).toBe('saved')
    expect(using.calls.reads).toEqual(['labels = "checkout" AND status != Done'])
  })
})

const back = { kind: 'backToFinding' } as const

describe('going back to finding', () => {
  test('from a query the picker can show, it keeps the query and its chips, and reads nothing', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, add(payments), READ_AT)

    await submitMilestoneQuery(using, TEAM, back, READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view.kind === 'milestoneStep' && view.editing).toBeUndefined()
  })

  test('from a query the picker can’t show, it clears the query, reading nothing', async () => {
    const using = await connected()
    await submitMilestoneQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    await submitMilestoneQuery(using, TEAM, back, READ_AT)
    const view = await milestoneStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind === 'milestoneStep' && (view.editing ?? view.read)).toBeUndefined()
  })
})
