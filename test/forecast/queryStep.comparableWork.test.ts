import { describe, expect, test } from 'vitest'
import { COMPARABLE_WORK, type InputsEdit } from '../../src/forecast/index.js'
import type { ForecastingForTest } from './forecastingForTest.js'
import {
  TEAM,
  payments,
  checkout,
  repay,
  bug,
  connected,
  onComparableWork,
  current,
  change,
  saved,
  savedEditing,
  stepView,
  add,
  remove,
  edit,
} from './queryStepScenario.js'

// The step for another of the team’s queries (#200), and the Comparable work step.

/** The comparable work step, as the Inputs screen opens at it. */
const comparableStep = (team: ForecastingForTest) => stepView(team, '', {}, 'comparableWork')

/** The milestone entered, or changed, as named and starting on `startDate`. */
const milestone = (name: string, startDate = '2026-09-01'): InputsEdit => ({ kind: 'setMilestone', name, startDate, ticketsRemaining: '30' })

// Through the handle, the other query a step edits is comparable work's: the step is the milestone query's, kept apart.
describe('the step, for another of the team’s queries (#200)', () => {
  test('picks, reads and saves that query, leaving the milestone query as it was', async () => {
    const team = await connected()
    await change(team, add(payments))

    await change(team, add(bug), 'comparableWork')
    const view = await comparableStep(team)

    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [bug], query: 'label:"bug"' })
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [bug], query: 'label:"bug"' })
    expect(view.lists).toEqual([
      { kind: 'milestone', choices: [payments, checkout], searchedInTracker: false, thisMilestone: payments.query },
      { kind: 'label', choices: [repay], searchedInTracker: false },
    ])
    expect(await team.searchedChoiceList('label', '', COMPARABLE_WORK)).toEqual({
      kind: 'label',
      choices: [repay],
      searchedInTracker: false,
    })
  })

  test('names what that query picks out when it matches nothing', async () => {
    const team = await connected()
    await team.submit({ form: 'inputs', edit: milestone('Payments v2') })
    await change(team, add(payments))

    await change(team, edit('label:"no such label"'), 'comparableWork')
    const view = await comparableStep(team)

    expect(current(team).comparableWorkQuery(TEAM)?.query).toBe('label:"no such label"')
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view.kind === 'comparableWorkStep' && view.pace?.flag).toBe(
      'This query matches nothing finished in the 8 whole weeks pace counts, so pace comes from the milestone’s own tickets. Check it picks out work like the milestone’s.',
    )
  })
})

// The Comparable work step (#201): the same step, editing comparable work's query, kept apart from the milestone's.
describe('the Comparable work step', () => {
  test('opens with nothing added, reading nothing', async () => {
    const team = await connected()
    await change(team, add(payments))
    team.calls.reads = []

    const view = await comparableStep(team)

    expect(team.calls.reads).toEqual([])
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.read).toBeUndefined()
  })

  test('joins several picks with OR, saved apart from the milestone query, and reads it once and each pick once (#204)', async () => {
    const team = await connected()
    await change(team, add(checkout))
    team.calls.reads = []

    await change(team, add(payments), 'comparableWork')
    await change(team, add(bug), 'comparableWork')
    const view = await comparableStep(team)

    expect(team.calls.reads).toEqual(['milestone:"Payments v2"', 'milestone:"Payments v2" OR label:"bug"', 'milestone:"Payments v2"', 'label:"bug"'])
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(view).toMatchObject({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
  })

  test('its read line counts only the finished tickets in the window, its open tickets ignored', async () => {
    const team = await connected()
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')
    await change(team, add(bug), 'comparableWork')

    const view = await comparableStep(team)

    expect(view).toMatchObject({ read: '2 finished in the last 9 weeks' })
  })

  test('written by hand, is saved as written and read', async () => {
    const team = await connected()
    onComparableWork(team)

    const submitted = await change(team, edit('label:checkout -label:bug'), 'comparableWork')

    expect(submitted).toEqual(savedEditing('comparableWork'))
    expect(team.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(await comparableStep(team)).toMatchObject({ query: 'label:checkout -label:bug' })
  })

  test('removing the last chip leaves no comparable-work query', async () => {
    const team = await connected()
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')

    await change(team, remove(payments), 'comparableWork')

    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(await comparableStep(team)).toMatchObject({ picks: [], query: '' })
  })

  test('Start afresh clears all of comparable work at once, reading nothing, and leaves the milestone query as it was', async () => {
    const team = await connected()
    await change(team, add(checkout))
    await change(team, add(payments), 'comparableWork')
    await change(team, add(bug), 'comparableWork')
    team.calls.reads = []

    const submitted = await change(team, { kind: 'startAfresh' }, 'comparableWork')

    expect(submitted).toEqual(saved('comparableWork'))
    expect(team.calls.reads).toEqual([])
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(await comparableStep(team)).toMatchObject({ query: '' })
  })

  test('Start afresh with nothing added changes nothing', async () => {
    const team = await connected()

    // through the handle, a change that changes nothing goes where a saved one does
    expect(await change(team, { kind: 'startAfresh' }, 'comparableWork')).toEqual(saved('comparableWork'))
    expect(current(team).comparableWorkQuery(TEAM)).toBeUndefined()
  })

  test('carries over: a new name or start date for the milestone leaves comparable work as it was', async () => {
    const team = await connected()
    onComparableWork(team)
    await team.submit({ form: 'inputs', edit: milestone('Launch') })
    await change(team, add(payments), 'comparableWork')
    await change(team, add(bug), 'comparableWork')

    await team.submit({ form: 'inputs', edit: milestone('Loyalty', '2026-11-16') })

    expect(team.storage.milestoneInputs(TEAM)).toMatchObject({ name: 'Loyalty', startDate: '2026-11-16' })
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(await comparableStep(team)).toMatchObject({ picks: [payments, bug] })
  })

  test('carries over: the milestone query following the milestone to its new name leaves comparable work as it was, even of the old milestone', async () => {
    const team = await connected()
    await team.submit({ form: 'inputs', edit: milestone('Payments v2') })
    await change(team, add(payments))
    await change(team, add(payments), 'comparableWork')

    await team.submit({ form: 'inputs', edit: milestone('Checkout') })

    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })
})
