import { describe, expect, test } from 'vitest'
import {
  TEAM,
  payments,
  bug,
  connected,
  connectedToJira,
  onComparableWork,
  current,
  change,
  savedEditing,
  stepView,
  refusedStep,
  refusalOf,
  add,
  edit,
  reading,
} from './queryStepScenario.js'

// The flags (#197): a query the tracker rejects or that reaches outside the connection, and a read matching nothing or incomplete.

describe('a query the tracker rejects', () => {
  test('shows the tracker’s own message beside the query, keeping the last query that worked in use, with its read', async () => {
    const message = '"2026-13-45" is not a recognized date/time format. Please provide an ISO 8601 date/time value, such as YYYY-MM-DD.'
    const team = await connected(reading('closed:>2026-13-45', { failure: 'invalidQuery', message }))
    await change(team, add(payments))

    const submitted = await change(team, edit('closed:>2026-13-45'))
    const view = refusedStep(submitted)

    const refusal = `GitHub rejected this query: ${message}`
    expect(refusalOf(submitted)).toEqual({ query: 'closed:>2026-13-45', refusal })
    expect(team.calls.reads).toEqual(['milestone:"Payments v2"', 'closed:>2026-13-45'])
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({
      picks: [payments],
      query: 'milestone:"Payments v2"',
      read: '2 open · 1 finished in the last 9 weeks',
      editing: { typed: 'closed:>2026-13-45', readIn: 'shop-team/shop', refusal },
    })
  })

  test('joined from a pick, keeps the EM finding, with the chips of the last query that worked and the tracker’s message beside them', async () => {
    const message = 'The listed users cannot be searched.'
    const team = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'invalidQuery', message }))
    await change(team, add(payments))

    const submitted = await change(team, add(bug))
    const view = refusedStep(submitted)

    const refusal = `GitHub rejected this query: ${message}`
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 9 weeks', refusal })
    expect(view.editing).toBeUndefined()
  })

  test('on Jira, the message is Jira’s', async () => {
    const message = "Error in JQL Query: Expecting either a value, list or function but got '='."
    const team = await connectedToJira(reading('labels == comparable', { failure: 'invalidQuery', message }))

    const submitted = await change(team, edit('labels == comparable'))

    expect(refusalOf(submitted)).toEqual({ query: 'labels == comparable', refusal: `Jira rejected this query: ${message}` })
    expect(current(team).milestoneQuery(TEAM)).toBeUndefined()
  })
})

describe('a query reaching outside the connection', () => {
  test('on GitHub, is an error naming the connected repo, not read narrowed, keeping the last query that worked in use', async () => {
    const team = await connected(reading('repo:someone/else', { failure: 'outOfScope' }))
    await change(team, add(payments))

    const submitted = await change(team, edit('repo:someone/else'))

    expect(refusalOf(submitted)).toEqual({
      query: 'repo:someone/else',
      refusal: 'This query reaches outside shop-team/shop, the connected repo. Take out what names another repo, owner or organisation.',
    })
    expect(current(team).milestoneQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
  })

  test('on Jira, is an error naming the connected project', async () => {
    const team = await connectedToJira(reading('project = KAN', { failure: 'outOfScope' }))

    const submitted = await change(team, edit('project = KAN'))

    expect(refusalOf(submitted)).toEqual({
      query: 'project = KAN',
      refusal: 'This query reaches outside project SHOP, the connected Jira project. Take out what names another project.',
    })
  })
})

describe('a read flagged', () => {
  test('matching nothing is accepted, but flagged as matching nothing', async () => {
    const team = await connected()

    const submitted = await change(team, edit('label:"no such label"'))
    const view = await stepView(team)

    expect(submitted).toEqual(savedEditing())
    expect(current(team).milestoneQuery(TEAM)?.query).toBe('label:"no such label"')
    expect(view).toMatchObject({
      read: '0 open · 0 finished in the last 9 weeks',
      flag: 'This query matches nothing: no open tickets, and none finished in the last 9 weeks. Check it picks out the milestone’s tickets.',
    })
  })

  test('incomplete, shows no count, only the flag asking the EM to narrow the query', async () => {
    const team = await connected(reading('is:open', { tickets: [{ id: 'o1' }, { id: 'o2' }], incomplete: true }))

    await change(team, edit('is:open'))
    const view = await stepView(team)

    expect(view).toMatchObject({ flag: 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.' })
    // Part of a count would pass for the count, so no line is shown.
    expect(view.read).toBeUndefined()
  })

  test('a read with tickets, all of them, is not flagged', async () => {
    const team = await connected()
    await change(team, add(payments))

    const view = await stepView(team)

    expect(view.flag).toBeUndefined()
  })
})

// The Comparable work step's flags and refusals (#202): the milestone query's, worded for comparable work.
describe('the Comparable work step, flagged', () => {
  test('matching nothing finished is accepted, its open tickets ignored; whether it is used is the pace’s to flag', async () => {
    const team = await connected(reading('label:"wip"', { tickets: [{ id: 'w1' }, { id: 'w2' }], incomplete: false }))
    onComparableWork(team)

    const submitted = await change(team, edit('label:"wip"'), 'comparableWork')
    const view = await stepView(team, '', {}, 'comparableWork')

    expect(submitted).toEqual(savedEditing('comparableWork'))
    expect(current(team).comparableWorkQuery(TEAM)?.query).toBe('label:"wip"')
    expect(view).toMatchObject({
      read: '0 finished in the last 9 weeks',
    })
    expect(view.flag).toBeUndefined()
  })

  test('incomplete, shows no count, only the flag asking the EM to narrow the query', async () => {
    const team = await connected(reading('is:closed', { tickets: [{ id: 'd1', finishedAt: '2026-11-01T10:00:00Z' }], incomplete: true }))
    onComparableWork(team)

    await change(team, edit('is:closed'), 'comparableWork')
    const view = await stepView(team, '', {}, 'comparableWork')

    expect(view).toMatchObject({ flag: 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.' })
    expect(view.read).toBeUndefined()
  })

  test('with finished tickets in the window, is not flagged', async () => {
    const team = await connected()
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')

    const view = await stepView(team, '', {}, 'comparableWork')

    expect(view).toMatchObject({ read: '1 finished in the last 9 weeks' })
    expect(view.flag).toBeUndefined()
  })

  test('rejected by the tracker as edited by hand, stays open for editing as typed, with its message, the last query that worked in use', async () => {
    const message = '"2026-13-45" is not a recognized date/time format. Please provide an ISO 8601 date/time value, such as YYYY-MM-DD.'
    const team = await connected(reading('closed:>2026-13-45', { failure: 'invalidQuery', message }))
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')

    const submitted = await change(team, edit('closed:>2026-13-45'), 'comparableWork')
    const view = refusedStep(submitted)

    const refusal = `GitHub rejected this query: ${message}`
    expect(refusalOf(submitted)).toEqual({ query: 'closed:>2026-13-45', refusal })
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({
      picks: [payments],
      query: 'milestone:"Payments v2"',
      read: '1 finished in the last 9 weeks',
      editing: { typed: 'closed:>2026-13-45', readIn: 'shop-team/shop', refusal },
    })
  })

  test('rejected by the tracker as joined from a pick, keeps the EM finding, with the chips that worked and its message', async () => {
    const message = 'The listed users cannot be searched.'
    const team = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'invalidQuery', message }))
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')

    const submitted = await change(team, add(bug), 'comparableWork')
    const view = refusedStep(submitted)

    const refusal = `GitHub rejected this query: ${message}`
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '1 finished in the last 9 weeks', refusal })
    expect(view.editing).toBeUndefined()
  })

  test('reaching outside the connection as edited by hand, stays open for editing, naming the connected repo, the last query that worked in use', async () => {
    const team = await connected(reading('repo:someone/else', { failure: 'outOfScope' }))
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')

    const submitted = await change(team, edit('repo:someone/else'), 'comparableWork')
    const view = refusedStep(submitted)

    const refusal = 'This query reaches outside shop-team/shop, the connected repo. Take out what names another repo, owner or organisation.'
    expect(refusalOf(submitted)).toEqual({ query: 'repo:someone/else', refusal })
    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], read: '1 finished in the last 9 weeks', editing: { typed: 'repo:someone/else', refusal } })
  })

  test('reaching outside the connection as joined from a pick, keeps the EM finding, with the chips that worked', async () => {
    const team = await connected(reading('milestone:"Payments v2" OR label:"bug"', { failure: 'outOfScope' }))
    onComparableWork(team)
    await change(team, add(payments), 'comparableWork')

    const submitted = await change(team, add(bug), 'comparableWork')
    const view = refusedStep(submitted)

    expect(current(team).comparableWorkQuery(TEAM)).toEqual({ picks: [payments], query: 'milestone:"Payments v2"' })
    expect(view).toMatchObject({ picks: [payments], refusal: expect.stringContaining('reaches outside shop-team/shop') })
    expect(view.editing).toBeUndefined()
  })

  test('rejected as the first query, leaves no comparable work', async () => {
    const message = "Error in JQL Query: Expecting either a value, list or function but got '='."
    const team = await connectedToJira(reading('labels == comparable', { failure: 'invalidQuery', message }))
    onComparableWork(team)

    const submitted = await change(team, edit('labels == comparable'), 'comparableWork')
    const view = refusedStep(submitted)

    expect(refusalOf(submitted)).toEqual({ query: 'labels == comparable', refusal: `Jira rejected this query: ${message}` })
    expect(current(team).comparableWorkQuery(TEAM)).toBeUndefined()
    expect(view).toMatchObject({ query: '' })
  })
})
