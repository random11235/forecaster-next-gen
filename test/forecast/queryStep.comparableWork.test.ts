import { describe, expect, test } from 'vitest'
import { queryStepView, searchedChoiceList, submitStepQuery } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK, type StepQuery } from '../../src/forecast/stepQuery.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { followRenamedMilestone } from '../../src/forecast/milestoneRenamed.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import { TEAM, READ_AT, payments, checkout, repay, bug, storage, connected, add, remove, edit, reading, connectedToJira } from './queryStepScenario.js'

// The step for another of the team’s queries (#200), and the Comparable work step.

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
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
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
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
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
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments, bug], query: 'milestone:"Payments v2" OR label:"bug"' })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
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
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [], query: 'label:checkout -label:bug' })
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ query: 'label:checkout -label:bug' })
  })

  test('removing the last chip leaves no comparable-work query', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    await submitStepQuery(using, TEAM, remove(payments), READ_AT, COMPARABLE_WORK)

    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
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
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [], query: '' })
    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ query: '' })
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
    expect(await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)).toMatchObject({ picks: [payments, bug] })
  })

  test('carries over: the milestone query following the milestone to its new name leaves comparable work as it was, even of the old milestone', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    await followRenamedMilestone(using, TEAM, { from: 'Payments v2', to: 'Checkout' }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [checkout], query: 'milestone:"Checkout"' })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
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
      read: '0 finished in the last 9 weeks',
    })
    expect(view.kind !== 'noQueryStep' && view.flag).toBeUndefined()
  })

  test('incomplete, shows no count, only the flag asking the EM to narrow the query', async () => {
    const using = await connected(reading('is:closed', { tickets: [{ id: 'd1', finishedAt: '2026-11-01T10:00:00Z' }], incomplete: true }))

    await submitStepQuery(using, TEAM, edit('is:closed'), READ_AT, COMPARABLE_WORK)
    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(view).toMatchObject({ flag: 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.' })
    expect(view.kind !== 'noQueryStep' && view.read).toBeUndefined()
  })

  test('with finished tickets in the window, is not flagged', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const view = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(view).toMatchObject({ read: '1 finished in the last 9 weeks' })
    expect(view.kind !== 'noQueryStep' && view.flag).toBeUndefined()
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
      read: '1 finished in the last 9 weeks',
      editing: { typed: 'closed:>2026-13-45', readIn: 'shop-team/shop', refusal },
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
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '1 finished in the last 9 weeks', refusal })
    expect(view && view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
  })

  test('reaching outside the connection as edited by hand, stays open for editing, naming the connected repo, the last query that worked in use', async () => {
    const using = await connected(reading('repo:someone/else', { failure: 'outOfScope' }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const submitted = await submitStepQuery(using, TEAM, edit('repo:someone/else'), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    const refusal = 'This query reaches outside shop-team/shop, the connected repo. Take out what names another repo, owner or organisation.'
    expect(submitted).toEqual({ kind: 'refused', query: 'repo:someone/else', refusal })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], read: '1 finished in the last 9 weeks', editing: { typed: 'repo:someone/else', refusal } })
  })

  test('reaching outside the connection as joined from a pick, keeps the EM finding, with the chips that worked', async () => {
    const using = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'outOfScope' }))
    await submitStepQuery(using, TEAM, add(payments), READ_AT, COMPARABLE_WORK)

    const submitted = await submitStepQuery(using, TEAM, add(bug), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], refusal: expect.stringContaining('reaches outside shop-team/shop') })
    expect(view && view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
  })

  test('rejected as the first query, leaves no comparable work', async () => {
    const message = "Error in JQL Query: Expecting either a value, list or function but got '='."
    const using = await connectedToJira(reading('labels == comparable', { failure: 'invalidQuery', message }))

    const submitted = await submitStepQuery(using, TEAM, edit('labels == comparable'), READ_AT, COMPARABLE_WORK)
    const view = submitted.kind === 'refused' && (await queryStepView(using, TEAM, '', { refused: submitted }, COMPARABLE_WORK))

    expect(submitted).toEqual({ kind: 'refused', query: 'labels == comparable', refusal: `Jira rejected this query: ${message}` })
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()
    expect(view).toMatchObject({ query: '' })
  })
})
