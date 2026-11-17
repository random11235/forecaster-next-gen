import { describe, expect, test } from 'vitest'
import { queryStepView, submitStepQuery } from '../../src/forecast/queryStep.js'
import { TEAM, READ_AT, payments, bug, storage, connected, add, edit, reading, connectedToJira } from './queryStepScenario.js'

// The flags (#197): a query the tracker rejects or that reaches outside the connection, and a read matching nothing or incomplete.

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
      read: '2 open · 1 finished in the last 9 weeks',
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
    expect(view).toMatchObject({ picks: [payments], query: 'milestone:"Payments v2"', read: '2 open · 1 finished in the last 9 weeks', refusal })
    expect(view && view.kind !== 'noQueryStep' && view.editing).toBeUndefined()
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
      read: '0 open · 0 finished in the last 9 weeks',
      flag: 'This query matches nothing: no open tickets, and none finished in the last 9 weeks. Check it picks out the milestone’s tickets.',
    })
  })

  test('incomplete, shows no count, only the flag asking the EM to narrow the query', async () => {
    const using = await connected(reading('is:open', { tickets: [{ id: 'o1' }, { id: 'o2' }], incomplete: true }))

    await submitStepQuery(using, TEAM, edit('is:open'), READ_AT)
    const view = await queryStepView(using, TEAM)

    expect(view).toMatchObject({ flag: 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.' })
    // Part of a count would pass for the count, so no line is shown.
    expect(view.kind !== 'noQueryStep' && view.read).toBeUndefined()
  })

  test('a read with tickets, all of them, is not flagged', async () => {
    const using = await connected()
    await submitStepQuery(using, TEAM, add(payments), READ_AT)

    const view = await queryStepView(using, TEAM)

    expect(view.kind !== 'noQueryStep' && view.flag).toBeUndefined()
  })
})
