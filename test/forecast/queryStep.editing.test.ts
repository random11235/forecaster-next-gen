import { describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { queryStepView, submitStepQuery } from '../../src/forecast/queryStep.js'
import { submitConnection } from '../../src/forecast/connection.js'
import {
  TEAM,
  READ_AT,
  payments,
  checkout,
  repay,
  bug,
  FIXTURE,
  connecting,
  connected,
  add,
  edit,
  back,
  backConfirmed,
  connectedToJira,
  useTeamDatabase,
} from './queryStepScenario.js'
import { currentStorage } from '../tempDatabase.js'

// The Milestone step (#191): editing the milestone query by hand, the queries refused before reading, and going back to finding.

useTeamDatabase()

describe('editing as a query', () => {
  test('a hand-edited query is saved as written and read once, when submitted', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(view).toMatchObject({ picks: [], query: 'label:checkout -label:bug', read: '1 open · 0 finished in the last 9 weeks' })
  })

  test('Edit as a query opens the milestone query for editing, read within the connected repo', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM, '', { editing: true })

    expect(view.kind !== 'noQueryStep' && view.editing).toEqual({ typed: 'milestone:"Payments v2"', readIn: 'shop-team/shop' })
  })

  test('the step opens on finding, not editing, until asked', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM)

    expect(view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
  })

  test('a query the picker can’t show stays open for editing, warning that going back to finding clears it', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    const view = await queryStepView(using, TEAM)

    expect(view.kind !== 'noQueryStep' && view.editing).toEqual({
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

    expect(editing.kind !== 'noQueryStep' && editing.editing).toEqual({ typed: 'label:"bug" OR milestone:"Payments v2"', readIn: 'shop-team/shop' })
    expect(finding).toMatchObject({
      picks: [bug, payments],
      query: 'label:"bug" OR milestone:"Payments v2"',
      lists: [
        { kind: 'milestone', choices: [checkout] },
        { kind: 'label', choices: [repay] },
      ],
    })
    expect(finding.kind !== 'noQueryStep' && finding.editing).toBeUndefined()
  })

  test('a query naming one choice twice can’t be shown as chips, which would show it once', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('label:"bug" OR milestone:"Payments v2" OR label:"bug"'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:"bug" OR milestone:"Payments v2" OR label:"bug"' })
    expect(view.kind !== 'noQueryStep' && view.editing?.backClears).toBeDefined()
  })

  test('an OR inside brackets or quotes splits nothing', async () => {
    const using = await connected()

    await submitStepQuery(using, TEAM, edit('(label:"bug" OR milestone:"Payments v2")'), READ_AT)
    await submitStepQuery(using, TEAM, edit('label:"bug OR milestone"'), READ_AT)

    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:"bug OR milestone"' })
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
      expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [zebra, payments], query: 'label:"zebra" OR milestone:"Payments v2"' })
      expect(view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
    })

    test('nothing is searched for when the choices listed are enough', async () => {
      const using = await connected(LABELS_PAST_LIMIT)

      await submitStepQuery(using, TEAM, edit('label:"bug" OR milestone:"Payments v2"'), READ_AT)

      expect(using.calls.searches).toEqual([])
      expect(currentStorage().milestoneQuery(TEAM)?.picks).toEqual([bug, payments])
    })

    test('one already picked, though unlisted, keeps its chip without a search', async () => {
      const using = await connected(LABELS_PAST_LIMIT)
      await submitStepQuery(using, TEAM, add(cardPayments), READ_AT)

      await submitStepQuery(using, TEAM, edit('label:"bug" OR parent-issue:shop-team/shop#140'), READ_AT)

      expect(using.calls.searches).toEqual([])
      expect(currentStorage().milestoneQuery(TEAM)?.picks).toEqual([bug, cardPayments])
    })

    test('one no search finds leaves the query for editing by hand', async () => {
      const using = await connected(LABELS_PAST_LIMIT)

      await submitStepQuery(using, TEAM, edit('label:"zebra" OR label:"no such label"'), READ_AT)

      expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:"zebra" OR label:"no such label"' })
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
    expect(view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
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
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
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
    expect(currentStorage().milestoneQuery(TEAM)).toBeUndefined()
  })

  test('a mistyped qualifier the tracker accepts is read as written, unflagged', async () => {
    const using = await connected()

    const submitted = await submitStepQuery(using, TEAM, edit('lable:checkout'), READ_AT)

    expect(submitted?.kind).toBe('saved')
    expect(using.calls.reads).toEqual(['lable:checkout'])
  })

  test('on Jira, a text search and an empty value are refused; a clause with a value is read', async () => {
    const using = connecting()
    await submitConnection(using, TEAM, {
      kind: 'connect',
      tracker: 'jira',
      repo: '',
      site: 'shop.atlassian.net',
      projectKey: 'SHOP',
      email: 'em@shop.test',
      token: 'token',
    })

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

describe('going back to finding', () => {
  test('from a query the picker can show, it keeps the query and its chips, and reads nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await submitStepQuery(using, TEAM, back, READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
  })

  test('from a query the picker can’t show, it asks first, clearing nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    const submitted = await submitStepQuery(using, TEAM, back, READ_AT)
    const view = await queryStepView(using, TEAM, '', { confirmingBack: true })

    expect(submitted).toEqual({ kind: 'confirmClear' })
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(view.kind !== 'noQueryStep' && view.editing).toEqual({
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

    expect(view.kind !== 'noQueryStep' && view.editing).toEqual({ typed: 'milestone:"Payments v2"', readIn: 'shop-team/shop' })
  })

  test('once confirmed, from a query the picker can’t show, it clears the query, reading nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT)

    await submitStepQuery(using, TEAM, backConfirmed, READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind !== 'noQueryStep' && (view.editing ?? view.read)).toBeUndefined()
  })
})
