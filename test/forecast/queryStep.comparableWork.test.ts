import { describe, expect, test } from 'vitest'
import { queryStepView, searchedChoiceList, submitStepQuery } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK, type StepQuery } from '../../src/forecast/stepQuery.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { followRenamedMilestone } from '../../src/forecast/milestoneRenamed.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import { TEAM, READ_AT, payments, checkout, repay, bug, connected, add, remove, edit, reading, useTeamDatabase } from './queryStepScenario.js'
import { currentStorage } from '../tempDatabase.js'

// The step for another of the team’s queries (#200), and the Comparable work step.

useTeamDatabase()

describe('the step, for another of the team’s queries (#200)', () => {
  /** A query kept apart from the milestone query, as comparable work's will be: its picks and query in a map of their own. */
  function apart(): StepQuery & { kept: Map<string, MilestoneQuery> } {
    const kept = new Map<string, MilestoneQuery>()
    return {
      name: 'Other query',
      picksOut: 'the other tickets',
      kind: 'milestoneQuery',
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
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [bug], query: 'label:"bug"' })
    expect(view.kind !== 'noQueryStep' && view.lists).toEqual([
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
    expect(currentStorage().milestoneQuery(TEAM)).toBeUndefined()
    expect(view).toMatchObject({
      flag: 'This query matches nothing: no open tickets, and none finished in the last 9 weeks. Check it picks out the other tickets.',
    })
  })
})

// The Comparable work step (#201): the same step, editing comparable work's query, kept apart from the milestone's.
describe('the Comparable work step', () => {
  test('opens with nothing added, reading nothing', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    using.calls.reads = []

    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(using.calls.reads).toEqual([])
    expect(view).toMatchObject({ picks: [], query: '' })
    expect(view.kind !== 'noQueryStep' && view.read).toBeUndefined()
  })

  test('joins several picks with OR, saved apart from the milestone query, and reads it once and each pick once (#204)', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(checkout), READ_AT)
    using.calls.reads = []

    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)
    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(using.calls.reads).toEqual(['milestone:"Payments v2"', 'milestone:"Payments v2" OR label:"bug"', 'milestone:"Payments v2"', 'label:"bug"'])
    expect(currentStorage().comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(view).toMatchObject({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
  })

  test('its read line counts only the finished tickets in the window, its open tickets ignored', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)

    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(view).toMatchObject({ read: '2 finished in the last 9 weeks' })
  })

  test('written by hand, is saved as written and read', async () => {
    const using = await connected()

    const submitted = await submitStepQuery(using, TEAM, edit('label:checkout -label:bug'), READ_AT, COMPARABLE_WORK)

    expect(submitted.kind).toBe('saved')
    expect(using.calls.reads).toEqual(['label:checkout -label:bug'])
    expect(currentStorage().comparableWorkQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(currentStorage().milestoneQuery(TEAM)).toBeUndefined()
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ query: 'label:checkout -label:bug' })
  })

  test('removing the last chip leaves no comparable-work query', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    await submitStepQuery(using, TEAM, remove(payments), READ_AT, COMPARABLE_WORK)

    expect(currentStorage().comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ picks: [], query: '' })
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
    expect(currentStorage().comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ query: '' })
  })

  test('Start afresh with nothing added changes nothing', async () => {
    const using = await connected()

    expect(await submitStepQuery(using, TEAM, { kind: 'startAfresh' }, READ_AT, COMPARABLE_WORK)).toEqual({ kind: 'unchanged' })
    expect(currentStorage().comparableWorkQuery(TEAM)).toBeUndefined()
  })

  test('carries over: a new name or start date for the milestone leaves comparable work as it was', async () => {
    const using = await connected()
    submitInputs(currentStorage(), TEAM, DEFAULT_SETTINGS, '2026-11-12', {
      kind: 'setMilestone',
      name: 'Launch',
      startDate: '2026-09-01',
      ticketsRemaining: '30',
    })
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)
    await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)

    submitInputs(currentStorage(), TEAM, DEFAULT_SETTINGS, '2026-11-12', {
      kind: 'setMilestone',
      name: 'Loyalty',
      startDate: '2026-11-16',
      ticketsRemaining: '30',
    })

    expect(currentStorage().milestoneInputs(TEAM)).toMatchObject({ name: 'Loyalty', startDate: '2026-11-16' })
    expect(currentStorage().comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ picks: [payments, bug] })
  })

  test('carries over: the milestone query following the milestone to its new name leaves comparable work as it was, even of the old milestone', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    await followRenamedMilestone(using, TEAM, { from: 'Payments v2', to: 'Checkout' }, READ_AT)

    expect(currentStorage().milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(currentStorage().comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })
})
