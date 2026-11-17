import { describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, ChoicesOfKind } from '../../src/connectors/connector.js'
import { queryStepView, searchedChoiceList, submitStepQuery } from '../../src/forecast/queryStep.js'
import { TEAM, READ_AT, payments, checkout, repay, bug, FIXTURE, connecting, connected, add, remove, useTeamDatabase } from './queryStepScenario.js'
import { currentStorage, openStorage } from '../tempDatabase.js'

// The Milestone step (#191): opening it, its lists of choices, and picking the milestone’s tickets.

useTeamDatabase()

describe('opening the Milestone step', () => {
  test('lists the choices by kind, asking for them once, with nothing picked and no read', async () => {
    const using = await connected()

    const view = await queryStepView(using, TEAM)

    expect(using.calls.choices).toBe(1)
    expect(using.calls.reads).toEqual([])
    expect(view).toEqual({
      kind: 'milestoneStep',
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

    expect(view.kind !== 'noQueryStep' && view.lists).toEqual([
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
    milestoneChoices: [{ kind: 'epic', choices: listed, pastLimit: true }, ...(FIXTURE.milestoneChoices as ChoicesOfKind[])],
    searchable: { epic: [...listed, cardPayments, payouts, ...Array.from({ length: 18 }, (_, i) => epic(142 + i))] },
  }

  test('is searched in the tracker for what is typed, while the other kinds are filtered here', async () => {
    const using = await connected(PAST_LIMIT)

    const view = await queryStepView(using, TEAM, ' Payments ')

    expect(using.calls.searches).toEqual([['epic', 'Payments']])
    expect(view.kind !== 'noQueryStep' && view.lists).toEqual([
      { kind: 'epic', choices: [cardPayments], searchedInTracker: true },
      { kind: 'milestone', choices: [payments], searchedInTracker: false },
      { kind: 'label', choices: [repay], searchedInTracker: false },
    ])
  })

  test('with nothing typed, lists the first 100, searching nothing', async () => {
    const using = await connected(PAST_LIMIT)

    const view = await queryStepView(using, TEAM)

    expect(using.calls.searches).toEqual([])
    expect(view.kind !== 'noQueryStep' && view.lists[0]).toEqual({ kind: 'epic', choices: listed, searchedInTracker: true })
  })

  test('leaves out of what the tracker finds the choices already picked', async () => {
    const using = await connected(PAST_LIMIT)
    await submitStepQuery(using, TEAM, add(cardPayments), READ_AT)

    const view = await queryStepView(using, TEAM, 'payments')

    expect(view.kind !== 'noQueryStep' && view.lists[0]).toEqual({ kind: 'epic', choices: [], searchedInTracker: true })
  })

  test('says so when the tracker can’t search, still listing the other kinds', async () => {
    const using = await connected({ ...PAST_LIMIT, searchable: { epic: { failure: 'unavailable' } } })

    const view = await queryStepView(using, TEAM, 'pay')

    expect(view.kind !== 'noQueryStep' && view.choicesFailure).toBeUndefined()
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
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 9 weeks' })
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
      read: '3 open · 2 finished in the last 9 weeks',
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
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 9 weeks' })
  })

  test('removing the last chip leaves no query, and nothing to read', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await submitStepQuery(using, TEAM, remove(payments), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind !== 'noQueryStep' && view.read).toBeUndefined()
  })

  test('picking what is already picked changes nothing and reads nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('the picks and query are saved, and still there after a restart', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(bug), READ_AT)
    const reopened = openStorage()
    const view = await queryStepView({ ...using, connections: reopened, queries: reopened, milestoneInputs: reopened, setup: reopened }, TEAM)

    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 9 weeks',
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
