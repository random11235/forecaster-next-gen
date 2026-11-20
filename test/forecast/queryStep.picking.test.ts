import { describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, ChoicesOfKind } from '../../src/connectors/connector.js'
import { MILESTONE_QUERY } from '../../src/forecast/index.js'
import { forecastingForTest } from './forecastingForTest.js'
import { TEAM, payments, checkout, repay, bug, FIXTURE, connected, current, change, stepView, add, remove } from './queryStepScenario.js'

// The Milestone step (#191): opening it, its lists of choices, and picking the milestone’s tickets.

describe('opening the Milestone step', () => {
  test('lists the choices by kind, asking for them once, with nothing picked and no read', async () => {
    const team = await connected()

    const view = await stepView(team)

    expect(team.calls.choices).toBe(1)
    expect(team.calls.reads).toEqual([])
    expect(view).toEqual({
      kind: 'milestoneStep',
      find: '',
      lists: [
        { kind: 'milestone', kindName: 'milestone', choices: [payments, checkout], searchedInTracker: false },
        { kind: 'label', kindName: 'label', choices: [repay, bug], searchedInTracker: false },
      ],
      picks: [],
      kindNames: { milestone: 'milestone', fixVersion: 'fix version', epic: 'epic', label: 'label' },
      query: '',
      note: 'Leaf tickets only. Epics include their sub-epics.',
    })
  })

  test('filters the lists by what is typed, ignoring case and matching part of a word', async () => {
    const team = await connected()

    const view = await stepView(team, 'PAY')

    expect(view.lists).toEqual([
      { kind: 'milestone', kindName: 'milestone', choices: [payments], searchedInTracker: false },
      { kind: 'label', kindName: 'label', choices: [repay], searchedInTracker: false },
    ])
  })

  test('the browser build, with nothing to connect with, has no Milestone step', async () => {
    const team = await forecastingForTest({ browser: true, setupOpen: true })

    expect((await team.inputsScreen({ step: 'milestone' })).step).toBeUndefined()
  })

  test('before connecting, there is no Milestone step', async () => {
    const team = await forecastingForTest({ fixture: FIXTURE, setupOpen: true })

    expect((await team.inputsScreen({ step: 'milestone' })).step).toBeUndefined()
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
    const team = await connected(PAST_LIMIT)

    const view = await stepView(team, ' Payments ')

    expect(team.calls.searches).toEqual([['epic', 'Payments']])
    expect(view.lists).toEqual([
      { kind: 'epic', kindName: 'epic', choices: [cardPayments], searchedInTracker: true },
      { kind: 'milestone', kindName: 'milestone', choices: [payments], searchedInTracker: false },
      { kind: 'label', kindName: 'label', choices: [repay], searchedInTracker: false },
    ])
  })

  test('with nothing typed, lists the first 100, searching nothing', async () => {
    const team = await connected(PAST_LIMIT)

    const view = await stepView(team)

    expect(team.calls.searches).toEqual([])
    expect(view.lists[0]).toEqual({ kind: 'epic', kindName: 'epic', choices: listed, searchedInTracker: true })
  })

  test('leaves out of what the tracker finds the choices already picked', async () => {
    const team = await connected(PAST_LIMIT)
    await change(team, add(cardPayments))

    const view = await stepView(team, 'payments')

    expect(view.lists[0]).toEqual({ kind: 'epic', kindName: 'epic', choices: [], searchedInTracker: true })
  })

  test('says so when the tracker can’t search, still listing the other kinds', async () => {
    const team = await connected({ ...PAST_LIMIT, searchable: { epic: { failure: 'unavailable' } } })

    const view = await stepView(team, 'pay')

    expect(view.choicesFailure).toBeUndefined()
    expect(view).toMatchObject({
      lists: [
        {
          kind: 'epic',
          kindName: 'epic',
          choices: [],
          searchedInTracker: true,
          failure: 'The tracker couldn’t search its epics just now. Try again in a few minutes.',
        },
        { kind: 'milestone', kindName: 'milestone', choices: [payments], searchedInTracker: false },
        { kind: 'label', kindName: 'label', choices: [repay], searchedInTracker: false },
      ],
    })
  })

  test('one kind searched on its own, as the picker asks for it while the EM types', async () => {
    const team = await connected(PAST_LIMIT)

    expect(await team.searchedChoiceList('epic', 'payouts', MILESTONE_QUERY)).toEqual({
      kind: 'epic',
      kindName: 'epic',
      choices: [payouts],
      searchedInTracker: true,
    })
    expect(team.calls.choices).toBe(0)
  })

  test('one kind asked for with nothing typed, once the find box is cleared, lists its first 100 again, searching nothing', async () => {
    const team = await connected(PAST_LIMIT)
    await change(team, add(epic(1)))

    const list = await team.searchedChoiceList('epic', '  ', MILESTONE_QUERY)

    expect(team.calls.searches).toEqual([])
    expect(list).toEqual({ kind: 'epic', kindName: 'epic', choices: listed.slice(1), searchedInTracker: true })
  })
})

describe('picking', () => {
  test('a pick becomes a chip, and the milestone query, read once, showing its line', async () => {
    const team = await connected()

    await change(team, add(payments))
    const view = await stepView(team)

    expect(team.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 9 weeks' })
  })

  test('picks are joined with OR into one query, read once for the lot, and leave the lists', async () => {
    const team = await connected()

    await change(team, add(payments))
    await change(team, add(bug))
    const view = await stepView(team)

    expect(team.calls.reads).toEqual(['milestone:"Payments v2"', 'milestone:"Payments v2" OR label:"bug"'])
    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 9 weeks',
      lists: [
        { kind: 'milestone', kindName: 'milestone', choices: [checkout], searchedInTracker: false },
        { kind: 'label', kindName: 'label', choices: [repay], searchedInTracker: false },
      ],
    })
  })

  test('removing a chip takes its query out and reads the rest again', async () => {
    const team = await connected()
    await change(team, add(payments))
    await change(team, add(bug))

    await change(team, remove(bug))
    const view = await stepView(team)

    expect(team.calls.reads.at(-1)).toBe('milestone:"Payments v2"')
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 9 weeks' })
  })

  test('removing the last chip leaves no query, and nothing to read', async () => {
    const team = await connected()
    await change(team, add(payments))

    await change(team, remove(payments))
    const view = await stepView(team)

    expect(team.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.read).toBeUndefined()
  })

  test('picking what is already picked changes nothing and reads nothing', async () => {
    const team = await connected()
    await change(team, add(payments))

    await change(team, add(payments))

    expect(team.calls.reads).toEqual(['milestone:"Payments v2"'])
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('the picks and query are saved, and still there after a restart', async () => {
    const team = await connected()
    await change(team, add(payments))
    await change(team, add(bug))
    team.restart()

    const view = await stepView(team)

    expect(view).toMatchObject({
      picks: [payments, bug],
      query: 'milestone:"Payments v2" OR label:"bug"',
      read: '3 open · 2 finished in the last 9 weeks',
    })
  })

  test('opening the step reads nothing: the line is the query’s saved read', async () => {
    const team = await connected()
    await change(team, add(payments))

    await stepView(team)
    await stepView(team, 'pay')

    expect(team.calls.reads).toEqual(['milestone:"Payments v2"'])
  })
})
