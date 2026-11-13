import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, ChoicesOfKind, Connector } from '../../src/connectors/connector.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { queryStepView, searchedChoiceList, submitStepQuery } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK, type StepQuery } from '../../src/forecast/queryStep.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { followRenamedMilestone } from '../../src/forecast/milestoneRenamed.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
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

    const view = await queryStepView(using, TEAM)

    expect(using.calls.choices).toBe(1)
    expect(using.calls.reads).toEqual([])
    expect(view).toEqual({
      kind: 'queryStep',
      find: '',
      lists: [
        { kind: 'milestone', choices: [payments, checkout], searchedInTracker: false },
        { kind: 'label', choices: [repay, bug], searchedInTracker: false },
      ],
      picks: [],
      query: '',
      note: 'Leaf tickets only. Epics include their sub-epics.',
    })
  })

  test('filters the lists by what is typed, ignoring case and matching part of a word', async () => {
    const using = await connected()

    const view = await queryStepView(using, TEAM, 'PAY')

    expect(view.kind === 'queryStep' && view.lists).toEqual([
      { kind: 'milestone', choices: [payments], searchedInTracker: false },
      { kind: 'label', choices: [repay], searchedInTracker: false },
    ])
  })

  test('the browser build, with nothing to connect with, has no Milestone step', async () => {
    expect(await queryStepView(undefined, TEAM)).toEqual({ kind: 'noQueryStep' })
  })

  test('before connecting, there is no Milestone step', async () => {
    expect(await queryStepView(connecting(), TEAM)).toEqual({ kind: 'noQueryStep' })
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
    searchable: { epic: [...listed, cardPayments, payouts, ...Array.from({ length: 18 }, (_, i) => epic(142 + i))] },
  }

  test('is searched in the tracker for what is typed, while the other kinds are filtered here', async () => {
    const using = await connected(PAST_LIMIT)

    const view = await queryStepView(using, TEAM, ' Payments ')

    expect(using.calls.searches).toEqual([['epic', 'Payments']])
    expect(view.kind === 'queryStep' && view.lists).toEqual([
      { kind: 'epic', choices: [cardPayments], searchedInTracker: true },
      { kind: 'milestone', choices: [payments], searchedInTracker: false },
      { kind: 'label', choices: [repay], searchedInTracker: false },
    ])
  })

  test('with nothing typed, lists the first 100, searching nothing', async () => {
    const using = await connected(PAST_LIMIT)

    const view = await queryStepView(using, TEAM)

    expect(using.calls.searches).toEqual([])
    expect(view.kind === 'queryStep' && view.lists[0]).toEqual({ kind: 'epic', choices: listed, searchedInTracker: true })
  })

  test('leaves out of what the tracker finds the choices already picked', async () => {
    const using = await connected(PAST_LIMIT)
    await submitStepQuery(using, TEAM, add(cardPayments), READ_AT)

    const view = await queryStepView(using, TEAM, 'payments')

    expect(view.kind === 'queryStep' && view.lists[0]).toEqual({ kind: 'epic', choices: [], searchedInTracker: true })
  })

  test('says so when the tracker can’t search, still listing the other kinds', async () => {
    const using = await connected({ ...PAST_LIMIT, searchable: { epic: { failure: 'unavailable' } } })

    const view = await queryStepView(using, TEAM, 'pay')

    expect(view.kind === 'queryStep' && view.choicesFailure).toBeUndefined()
    expect(view).toMatchObject({
      lists: [
        { kind: 'epic', choices: [], searchedInTracker: true, failure: 'The tracker couldn’t search its epics just now. Try again in a few minutes.' },
        { kind: 'milestone', choices: [payments], searchedInTracker: false },
        { kind: 'label', choices: [repay], searchedInTracker: false },
      ],
    })
  })

  test('one kind searched on its own, as the picker asks for it while the EM types', async () => {
    const using = await connected(PAST_LIMIT)

    expect(await searchedChoiceList(using, TEAM, 'epic', 'payouts')).toEqual({ kind: 'epic', choices: [payouts], searchedInTracker: true })
    expect(using.calls.choices).toBe(0)
  })

  test('one kind asked for with nothing typed, once the find box is cleared, lists its first 100 again, searching nothing', async () => {
    const using = await connected(PAST_LIMIT)
    await submitStepQuery(using, TEAM, add(epic(1)), READ_AT)

    const list = await searchedChoiceList(using, TEAM, 'epic', '  ')

    expect(using.calls.searches).toEqual([])
    expect(list).toEqual({ kind: 'epic', choices: listed.slice(1), searchedInTracker: true })
  })
})

describe('picking', () => {
  test('a pick becomes a chip, and the milestone query, read once, showing its line', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 8 weeks' })
  })

  test('picks are joined with OR into one query, read once for the lot, and leave the lists', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(bug), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"', 'milestone:"Payments v2" OR label:"bug"'])
    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 8 weeks',
      lists: [
        { kind: 'milestone', choices: [checkout], searchedInTracker: false },
        { kind: 'label', choices: [repay], searchedInTracker: false },
      ],
    })
  })

  test('removing a chip takes its query out and reads the rest again', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(bug), READ_AT)

    await submitStepQuery(using, TEAM, remove(bug), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads.at(-1)).toBe('milestone:"Payments v2"')
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 8 weeks' })
  })

  test('removing the last chip leaves no query, and nothing to read', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await submitStepQuery(using, TEAM, remove(payments), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind === 'queryStep' && view.read).toBeUndefined()
  })

  test('picking what is already picked changes nothing and reads nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('the picks and query are saved, and still there after a restart', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(bug), READ_AT)
    storage.close()

    storage = openSqliteStorage(file)
    const view = await queryStepView({ ...using, connections: storage, reads: storage, milestoneQueries: storage }, TEAM)

    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 8 weeks',
    })
  })

  test('opening the step reads nothing: the line is the query’s saved read', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await queryStepView(using, TEAM)
    await queryStepView(using, TEAM, 'pay')

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
  })
})

const edit = (query: string) => ({ kind: 'editQuery', query }) as const

describe('editing as a query', () => {
  test('a hand-edited query is saved as written and read once, when submitted', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(view).toMatchObject({ picks: [], query: 'label:checkout -label:bug', read: '1 open · 0 finished in the last 8 weeks' })
  })

  test('Edit as a query opens the milestone query for editing, read within the connected repo', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM, '', { editing: true })

    expect(view.kind === 'queryStep' && view.editing).toEqual({ typed: 'milestone:"Payments v2"', readIn: 'shop-team/shop' })
  })

  test('the step opens on finding, not editing, until asked', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM)

    expect(view.kind === 'queryStep' && view.editing).toBeUndefined()
  })

  test('a query the picker can’t show stays open for editing, warning that going back to finding clears it', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    const view = await queryStepView(using, TEAM)

    expect(view.kind === 'queryStep' && view.editing).toEqual({
      typed: 'label:checkout -label:bug',
      readIn: 'shop-team/shop',
      backClears: 'The picker can’t show this query, so going back to finding clears it.',
    })
  })

  test('a hand-edited query that is an OR of choices’ queries comes back as their chips, with no warning', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('label:"bug" OR milestone:"Payments v2"'), READ_AT)
    const editing = await queryStepView(using, TEAM, '', { editing: true })
    const finding = await queryStepView(using, TEAM)

    expect(editing.kind === 'queryStep' && editing.editing).toEqual({ typed: 'label:"bug" OR milestone:"Payments v2"', readIn: 'shop-team/shop' })
    expect(finding).toMatchObject({
      picks: [bug, payments],
      query: 'label:"bug" OR milestone:"Payments v2"',
      lists: [
        { kind: 'milestone', choices: [checkout] },
        { kind: 'label', choices: [repay] },
      ],
    })
    expect(finding.kind === 'queryStep' && finding.editing).toBeUndefined()
  })

  test('a query naming one choice twice can’t be shown as chips, which would show it once', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('label:"bug" OR milestone:"Payments v2" OR label:"bug"'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:"bug" OR milestone:"Payments v2" OR label:"bug"' })
    expect(view.kind === 'queryStep' && view.editing?.backClears).toBeDefined()
  })

  test('an OR inside brackets or quotes splits nothing', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('(label:"bug" OR milestone:"Payments v2")'), READ_AT)
    await submitStepQuery(using, TEAM, edit('label:"bug OR milestone"'), READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:"bug OR milestone"' })
  })

  describe('naming a choice of a kind with more than 100 entries', () => {
    const zebra: Choice = { kind: 'label', name: 'zebra', query: 'label:"zebra"' }
    const zebras: Choice = { kind: 'label', name: 'zebras', query: 'label:"zebras"' }
    const cardPayments: Choice = { kind: 'epic', name: 'Card payments', query: 'parent-issue:shop-team/shop#140' }
    /** More labels than are listed, "zebra" among those that aren't; and the milestones in full. */
    const LABELS_PAST_LIMIT: CannedFixture = {
      ...FIXTURE,
      milestoneChoices: [
        { kind: 'epic', choices: [], pastLimit: true },
        { kind: 'milestone', choices: [payments, checkout], pastLimit: false },
        { kind: 'label', choices: [repay, bug], pastLimit: true },
      ],
      searchable: { epic: [cardPayments], label: [repay, bug, zebras, zebra] },
      reads: {
        ...FIXTURE.reads,
        'label:"zebra" OR milestone:"Payments v2"': { tickets: [{ id: 'z1' }], incomplete: false },
        'parent-issue:shop-team/shop#140': { tickets: [{ id: 'e1' }], incomplete: false },
        'label:"bug" OR parent-issue:shop-team/shop#140': { tickets: [{ id: 'e1' }], incomplete: false },
      },
    }

    test('one the tracker doesn’t list is found by searching that kind for its name, and comes back as its chip', async () => {
      const using = await connected(LABELS_PAST_LIMIT)

      await submitStepQuery(using, TEAM, edit('label:"zebra" OR milestone:"Payments v2"'), READ_AT)
      const view = await queryStepView(using, TEAM)

      expect(using.calls.searches).toContainEqual(['label', 'zebra'])
      expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [zebra, payments], query: 'label:"zebra" OR milestone:"Payments v2"' })
      expect(view.kind === 'queryStep' && view.editing).toBeUndefined()
    })

    test('nothing is searched for when the choices listed are enough', async () => {
      const using = await connected(LABELS_PAST_LIMIT)

      await submitStepQuery(using, TEAM, edit('label:"bug" OR milestone:"Payments v2"'), READ_AT)

      expect(using.calls.searches).toEqual([])
      expect(storage.milestoneQuery(TEAM)?.picks).toEqual([bug, payments])
    })

    test('one already picked, though unlisted, keeps its chip without a search', async () => {
      const using = await connected(LABELS_PAST_LIMIT)
      await submitStepQuery(using, TEAM, add(cardPayments), READ_AT)

      await submitStepQuery(using, TEAM, edit('label:"bug" OR parent-issue:shop-team/shop#140'), READ_AT)

      expect(using.calls.searches).toEqual([])
      expect(storage.milestoneQuery(TEAM)?.picks).toEqual([bug, cardPayments])
    })

    test('one no search finds leaves the query for editing by hand', async () => {
      const using = await connected(LABELS_PAST_LIMIT)

      await submitStepQuery(using, TEAM, edit('label:"zebra" OR label:"no such label"'), READ_AT)

      expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:"zebra" OR label:"no such label"' })
    })
  })

  test('on Jira, a query joined with a lower-case or comes back as chips', async () => {
    const launch: Choice = { kind: 'fixVersion', name: 'Launch', query: 'fixVersion = "Launch"' }
    const urgent: Choice = { kind: 'label', name: 'urgent', query: 'labels = "urgent"' }
    const using = await connectedToJira({
      milestoneChoices: [
        { kind: 'fixVersion', choices: [launch], pastLimit: false },
        { kind: 'label', choices: [urgent], pastLimit: false },
      ],
      reads: { 'fixVersion = "Launch" or labels = "urgent"': { tickets: [{ id: 'j1' }], incomplete: false } },
    })

    await submitStepQuery(using, TEAM, edit('fixVersion = "Launch" or labels = "urgent"'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(view).toMatchObject({ picks: [launch, urgent], query: 'fixVersion = "Launch" or labels = "urgent"' })
    expect(view.kind === 'queryStep' && view.editing).toBeUndefined()
  })
})

describe('a hand-edited query refused before reading', () => {
  test('free text is refused: nothing is saved or read, and the query stays as typed, with why', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const submitted = await submitStepQuery(using, TEAM, edit('label:checkout payments'), READ_AT)
    const view = submitted?.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }))

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

    const submitted = await submitStepQuery(using, TEAM, edit(query), READ_AT)

    expect(submitted?.kind === 'refused' && submitted.refusal).toContain(says)
    expect(using.calls.reads).toEqual([])
  })

  test.each([['label:'], ['label:""'], ['milestone:"Payments v2" OR -label:']])('an empty qualifier is refused: %s', async (query) => {
    const using = await connected()

    const submitted = await submitStepQuery(using, TEAM, edit(query), READ_AT)

    expect(submitted?.kind === 'refused' && submitted.refusal).toBe('label: names nothing. Give it one, such as label:"checkout".')
    expect(using.calls.reads).toEqual([])
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
  })

  test('a mistyped qualifier the tracker accepts is read as written, unflagged', async () => {
    const using = await connected()

    const submitted = await submitStepQuery(using, TEAM, edit('lable:checkout'), READ_AT)

    expect(submitted?.kind).toBe('saved')
    expect(using.calls.reads).toEqual(['lable:checkout'])
  })

  test('on Jira, a text search and an empty value are refused; a clause with a value is read', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' })

    const text = await submitStepQuery(using, TEAM, edit('labels = "checkout" OR text ~ "payments"'), READ_AT)
    const empty = await submitStepQuery(using, TEAM, edit('labels = '), READ_AT)
    const emptyQuoted = await submitStepQuery(using, TEAM, edit('fixVersion = "" AND labels = "checkout"'), READ_AT)
    const fine = await submitStepQuery(using, TEAM, edit('labels = "checkout" AND status != Done'), READ_AT)

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

const back = { kind: 'backToFinding', confirmed: false } as const
const backConfirmed = { kind: 'backToFinding', confirmed: true } as const

describe('going back to finding', () => {
  test('from a query the picker can show, it keeps the query and its chips, and reads nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await submitStepQuery(using, TEAM, back, READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view.kind === 'queryStep' && view.editing).toBeUndefined()
  })

  test('from a query the picker can’t show, it asks first, clearing nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    const submitted = await submitStepQuery(using, TEAM, back, READ_AT)
    const view = await queryStepView(using, TEAM, '', { confirmingBack: true })

    expect(submitted).toEqual({ kind: 'confirmClear' })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(view.kind === 'queryStep' && view.editing).toEqual({
      typed: 'label:checkout -label:bug',
      readIn: 'shop-team/shop',
      backClears: 'The picker can’t show this query, so going back to finding clears it.',
      confirmingBack: true,
    })
  })

  test('nothing is asked of a query the picker can show, though the step is opened to ask', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM, '', { editing: true, confirmingBack: true })

    expect(view.kind === 'queryStep' && view.editing).toEqual({ typed: 'milestone:"Payments v2"', readIn: 'shop-team/shop' })
  })

  test('once confirmed, from a query the picker can’t show, it clears the query, reading nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    await submitStepQuery(using, TEAM, backConfirmed, READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind === 'queryStep' && (view.editing ?? view.read)).toBeUndefined()
  })
})

// The flags (#197): a query the tracker rejects or that reaches outside the connection, and a read matching nothing or incomplete.

/** `FIXTURE`, its read of `query` answering `read`. */
function reading(query: string, read: CannedFixture['reads'][string]): CannedFixture {
  return { ...FIXTURE, reads: { ...FIXTURE.reads, [query]: read } }
}

/** The means to connect on `fixture`, connected to the Jira project SHOP. */
async function connectedToJira(fixture: CannedFixture): Promise<ReturnType<typeof connecting>> {
  const using = connecting(fixture)
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' })
  return using
}

describe('a query the tracker rejects', () => {
  test('shows the tracker’s own message beside the query, keeping the last query that worked in use, with its read', async () => {
    const message = '"2026-13-45" is not a recognized date/time format. Please provide an ISO 8601 date/time value, such as YYYY-MM-DD.'
    const using = await connected(reading('closed:>2026-13-45', { failure: 'invalidQuery', message }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const submitted = await submitStepQuery(using, TEAM, edit('closed:>2026-13-45'), READ_AT)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }))

    const refusal = `GitHub rejected this query: ${message}`
    expect(submitted).toEqual({ kind: 'refused', query: 'closed:>2026-13-45', refusal })
    expect(using.calls.reads).toEqual(['milestone:"Payments v2"', 'closed:>2026-13-45'])
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({
      picks: [payments],
      query: 'milestone:"Payments v2"',
      read: '2 open · 1 finished in the last 8 weeks',
      editing: { typed: 'closed:>2026-13-45', readIn: 'shop-team/shop', refusal },
    })
  })

  test('joined from a pick, keeps the EM finding, with the chips of the last query that worked and the tracker’s message beside them', async () => {
    const message = 'The listed users cannot be searched.'
    const using = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'invalidQuery', message }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const submitted = await submitStepQuery(using, TEAM, add(bug), READ_AT)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }))

    const refusal = `GitHub rejected this query: ${message}`
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 8 weeks', refusal })
    expect(view && view.kind === 'queryStep' && view.editing).toBeUndefined()
  })

  test('on Jira, the message is Jira’s', async () => {
    const message = "Error in JQL Query: Expecting either a value, list or function but got '='."
    const using = await connectedToJira(reading('labels == comparable', { failure: 'invalidQuery', message }))

    const submitted = await submitStepQuery(using, TEAM, edit('labels == comparable'), READ_AT)

    expect(submitted).toEqual({ kind: 'refused', query: 'labels == comparable', refusal: `Jira rejected this query: ${message}` })
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
  })
})

describe('a query reaching outside the connection', () => {
  test('on GitHub, is an error naming the connected repo, not read narrowed, keeping the last query that worked in use', async () => {
    const using = await connected(reading('repo:someone/else', { failure: 'outOfScope' }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const submitted = await submitStepQuery(using, TEAM, edit('repo:someone/else'), READ_AT)

    expect(submitted).toEqual({
      kind: 'refused',
      query: 'repo:someone/else',
      refusal: 'This query reaches outside shop-team/shop, the connected repo. Take out what names another repo, owner or organisation.',
    })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('on Jira, is an error naming the connected project', async () => {
    const using = await connectedToJira(reading('project = KAN', { failure: 'outOfScope' }))

    const submitted = await submitStepQuery(using, TEAM, edit('project = KAN'), READ_AT)

    expect(submitted).toEqual({
      kind: 'refused',
      query: 'project = KAN',
      refusal: 'This query reaches outside project SHOP, the connected Jira project. Take out what names another project.',
    })
  })
})

describe('a read flagged', () => {
  test('matching nothing is accepted, but flagged as matching nothing', async () => {
    const using = await connected()

    const submitted = await submitStepQuery(using, TEAM, edit('label:"no such label"'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(submitted.kind).toBe('saved')
    expect(storage.milestoneQuery(TEAM)?.query).toBe('label:"no such label"')
    expect(view).toMatchObject({
      read: '0 open · 0 finished in the last 8 weeks',
      flag: 'This query matches nothing: no open tickets, and none finished in the last 8 weeks. Check it picks out the milestone’s tickets.',
    })
  })

  test('incomplete, shows no count, only the flag asking the EM to narrow the query', async () => {
    const using = await connected(reading('is:open', { tickets: [{ id: 'o1' }, { id: 'o2' }], incomplete: true }))

    await submitStepQuery(using, TEAM, edit('is:open'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(view).toMatchObject({ flag: 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.' })
    // Part of a count would pass for the count, so no line is shown.
    expect(view.kind === 'queryStep' && view.read).toBeUndefined()
  })

  test('a read with tickets, all of them, is not flagged', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM)

    expect(view.kind === 'queryStep' && view.flag).toBeUndefined()
  })
})

describe('the step, for another of the team’s queries (#200)', () => {
  /** A query kept apart from the milestone query, as comparable work's will be: its picks and query in a map of their own. */
  function apart(): StepQuery & { kept: Map<string, MilestoneQuery> } {
    const kept = new Map<string, MilestoneQuery>()
    return {
      name: 'Other query',
      picksOut: 'the other tickets',
      optional: false,
      countsOpen: true,
      readsEachPick: false,
      saved: (_, teamId) => kept.get(teamId),
      save: (_, teamId, query) => void kept.set(teamId, query),
      kept,
    }
  }

  test('picks, reads and saves that query, leaving the milestone query as it was', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    const other = apart()

    await submitStepQuery(using, TEAM, add(bug), READ_AT, other)
    const view = await queryStepView(using, TEAM, '', {}, other)

    expect(other.kept.get(TEAM)).toEqual({ picks: [bug], query: 'label:"bug"' })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [bug], query: 'label:"bug"' })
    expect(view.kind === 'queryStep' && view.lists).toEqual([
      { kind: 'milestone', choices: [payments, checkout], searchedInTracker: false, thisMilestone: payments.query },
      { kind: 'label', choices: [repay], searchedInTracker: false },
    ])
    expect(await searchedChoiceList(using, TEAM, 'label', '', other)).toEqual({ kind: 'label', choices: [repay], searchedInTracker: false })
  })

  test('names what that query picks out when it matches nothing', async () => {
    const using = await connected()
    const other = apart()

    await submitStepQuery(using, TEAM, edit('label:"no such label"'), READ_AT, other)
    const view = await queryStepView(using, TEAM, '', {}, other)

    expect(other.kept.get(TEAM)?.query).toBe('label:"no such label"')
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
    expect(view).toMatchObject({
      flag: 'This query matches nothing: no open tickets, and none finished in the last 8 weeks. Check it picks out the other tickets.',
    })
  })
})

// The Comparable work step (#201): the same step, editing comparable work's query, kept apart from the milestone's.
describe('the Comparable work step', () => {
  test('opens with nothing added, reading nothing, its button reading Skip', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    using.calls.reads = []

    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(using.calls.reads).toEqual([])
    expect(view).toMatchObject({ picks: [], query: '', onward: 'skip' })
    expect(view.kind === 'queryStep' && view.read).toBeUndefined()
  })

  test('joins several picks with OR, saved apart from the milestone query, and reads it once and each pick once (#204), its button reading Next', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(checkout), READ_AT)
    using.calls.reads = []

    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)
    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(using.calls.reads).toEqual([
      'milestone:"Payments v2"',
      'milestone:"Payments v2" OR label:"bug"',
      'milestone:"Payments v2"',
      'label:"bug"',
    ])
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(view).toMatchObject({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"', onward: 'next' })
  })

  test('its read line counts only the finished tickets in the window, its open tickets ignored', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)

    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(view).toMatchObject({ read: '2 finished in the last 8 weeks' })
  })

  test('written by hand, is saved as written and read', async () => {
    const using = await connected()

    const submitted = await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT, COMPARABLE_WORK)

    expect(submitted.kind).toBe('saved')
    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ onward: 'next' })
  })

  test('removing the last chip leaves no comparable-work query, its button reading Skip again', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    await submitStepQuery(using, TEAM, remove(payments), READ_AT, COMPARABLE_WORK)

    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ picks: [], query: '', onward: 'skip' })
  })

  test('Start afresh clears all of comparable work at once, reading nothing, and leaves the milestone query as it was', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(checkout), READ_AT)
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)
    using.calls.reads = []

    const submitted = await submitStepQuery(using, TEAM, { kind: 'startAfresh' }, READ_AT, COMPARABLE_WORK)

    expect(submitted).toEqual({ kind: 'saved' })
    expect(using.calls.reads).toEqual([])
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ query: '', onward: 'skip' })
  })

  test('Start afresh with nothing added changes nothing', async () => {
    const using = await connected()

    expect(await submitStepQuery(using, TEAM, { kind: 'startAfresh' }, READ_AT, COMPARABLE_WORK)).toEqual({ kind: 'unchanged' })
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()
  })

  test('carries over: a new name or start date for the milestone leaves comparable work as it was', async () => {
    const using = await connected()
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, '2026-11-12', { kind: 'setMilestone', name: 'Launch', startDate: '2026-09-01', ticketsRemaining: '30' })
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)

    submitInputs(storage, TEAM, DEFAULT_SETTINGS, '2026-11-12', { kind: 'setMilestone', name: 'Loyalty', startDate: '2026-11-16', ticketsRemaining: '30' })

    expect(storage.milestoneInputs(TEAM)).toMatchObject({ name: 'Loyalty', startDate: '2026-11-16' })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ picks: [payments, bug], onward: 'next' })
  })

  test('carries over: the milestone query following the milestone to its new name leaves comparable work as it was, even of the old milestone', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    await followRenamedMilestone(using, TEAM, { from: 'Payments v2', to: 'Checkout' }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('the Milestone step has no Skip or Next of its own', async () => {
    const using = await connected()

    expect(await queryStepView(using, TEAM)).not.toHaveProperty('onward')
  })
})

// The Comparable work step's flags and refusals (#202): the milestone query's, worded for comparable work.
describe('the Comparable work step, flagged', () => {
  test('matching nothing finished is accepted, its open tickets ignored; whether it is used is the pace’s to flag', async () => {
    const using = await connected(reading('label:"wip"', { tickets: [{ id: 'w1' }, { id: 'w2' }], incomplete: false }))

    const submitted = await submitStepQuery(using, TEAM, edit('label:"wip"'), READ_AT, COMPARABLE_WORK)
    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(submitted.kind).toBe('saved')
    expect(storage.comparableWorkQuery(TEAM)?.query).toBe('label:"wip"')
    expect(view).toMatchObject({
      read: '0 finished in the last 8 weeks',
      onward: 'next',
    })
    expect(view.kind === 'queryStep' && view.flag).toBeUndefined()
  })

  test('incomplete, shows no count, only the flag asking the EM to narrow the query', async () => {
    const using = await connected(reading('is:closed', { tickets: [{ id: 'd1', finishedAt: '2026-11-01T10:00:00Z' }], incomplete: true }))

    await submitStepQuery(using, TEAM, edit('is:closed'), READ_AT, COMPARABLE_WORK)
    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(view).toMatchObject({ flag: 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.' })
    expect(view.kind === 'queryStep' && view.read).toBeUndefined()
  })

  test('with finished tickets in the window, is not flagged', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(view).toMatchObject({ read: '1 finished in the last 8 weeks' })
    expect(view.kind === 'queryStep' && view.flag).toBeUndefined()
  })

  test('rejected by the tracker as edited by hand, stays open for editing as typed, with its message, the last query that worked in use', async () => {
    const message = '"2026-13-45" is not a recognized date/time format. Please provide an ISO 8601 date/time value, such as YYYY-MM-DD.'
    const using = await connected(reading('closed:>2026-13-45', { failure: 'invalidQuery', message }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const submitted = await submitStepQuery(using, TEAM, edit('closed:>2026-13-45'), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    const refusal = `GitHub rejected this query: ${message}`
    expect(submitted).toEqual({ kind: 'refused', query: 'closed:>2026-13-45', refusal })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({
      picks: [payments],
      query: 'milestone:"Payments v2"',
      read: '1 finished in the last 8 weeks',
      editing: { typed: 'closed:>2026-13-45', readIn: 'shop-team/shop', refusal },
      onward: 'next',
    })
  })

  test('rejected by the tracker as joined from a pick, keeps the EM finding, with the chips that worked and its message', async () => {
    const message = 'The listed users cannot be searched.'
    const using = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'invalidQuery', message }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const submitted = await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    const refusal = `GitHub rejected this query: ${message}`
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '1 finished in the last 8 weeks', refusal })
    expect(view && view.kind === 'queryStep' && view.editing).toBeUndefined()
  })

  test('reaching outside the connection as edited by hand, stays open for editing, naming the connected repo, the last query that worked in use', async () => {
    const using = await connected(reading('repo:someone/else', { failure: 'outOfScope' }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const submitted = await submitStepQuery(using, TEAM, edit('repo:someone/else'), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    const refusal = 'This query reaches outside shop-team/shop, the connected repo. Take out what names another repo, owner or organisation.'
    expect(submitted).toEqual({ kind: 'refused', query: 'repo:someone/else', refusal })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], read: '1 finished in the last 8 weeks', editing: { typed: 'repo:someone/else', refusal } })
  })

  test('reaching outside the connection as joined from a pick, keeps the EM finding, with the chips that worked', async () => {
    const using = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'outOfScope' }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const submitted = await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], refusal: expect.stringContaining('reaches outside shop-team/shop') })
    expect(view && view.kind === 'queryStep' && view.editing).toBeUndefined()
  })

  test('rejected as the first query, leaves no comparable work, its button still reading Skip', async () => {
    const message = "Error in JQL Query: Expecting either a value, list or function but got '='."
    const using = await connectedToJira(reading('labels == comparable', { failure: 'invalidQuery', message }))

    const submitted = await submitStepQuery(using, TEAM, edit('labels == comparable'), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    expect(submitted).toEqual({ kind: 'refused', query: 'labels == comparable', refusal: `Jira rejected this query: ${message}` })
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()
    expect(view).toMatchObject({ query: '', onward: 'skip' })
  })
})
