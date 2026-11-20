import { describe, expect, test } from 'vitest'
import type { Ticket } from '../../src/connectors/connector.js'
import { CHECKOUT, TEAM, checkoutFixture, countAgain, forecastingForTest, pick, readAgain, skip, type ForecastingForTest } from './forecastingForTest.js'

// Finished tickets per period and tickets remaining, from a query's saved read (#187): read by the Milestone step,
// counted as the Comparable work step pairs the periods, and how far back each read asks the tracker.

// Monday 26 Oct, in the week of 24 Oct from a Saturday start, which is left out
const READ_AT = '2026-10-26T09:00:00Z'

/**
 * A team on GitHub whose milestone, Checkout v2, starts on `startDate`, every `cadenceDays`, its query picked in setup's
 * Milestone step and read at `readAt`, the EM in `timeZone`; today is `readAt`'s day there.
 */
async function readOf(tickets: Ticket[], { startDate = '2026-10-03', cadenceDays = '7', readAt = READ_AT, timeZone = 'UTC' } = {}) {
  const team = await forecastingForTest({ fixture: checkoutFixture(tickets), connected: true, setupOpen: true, clock: { now: readAt, timeZone } })
  await team.submit({ form: 'inputs', edit: { kind: 'setMilestone', name: 'Checkout v2', startDate, ticketsRemaining: '30' } })
  await team.submit({ form: 'inputs', edit: { kind: 'setCadence', cadenceDays } })
  await pick(team, readAt)
  return team
}

/** The periods the Comparable work step pairs: each start, and the milestone's count in it. */
async function periods(team: ForecastingForTest) {
  const { step } = await team.inputsScreen({ step: 'comparableWork' })
  if (step?.kind !== 'comparableWorkStep') throw new Error(`no Comparable work step: ${step?.kind}`)
  return step.pace?.periods.map(({ start, milestone }) => ({ start, milestone }))
}

/** `starts` paired with `counts`, as `periods` gives them. */
const dated = (starts: string[], counts: number[]) => starts.map((start, at) => ({ start, milestone: counts[at] }))

/** The Milestone step's line about its query's read. */
async function readLine(team: ForecastingForTest): Promise<string | undefined> {
  const { step } = await team.inputsScreen({ step: 'milestone' })
  return step?.kind === 'milestoneStep' ? step.read : undefined
}

/** The milestone's tickets remaining, as the Inputs screen shows its source once setup's picks are in use. */
async function ticketsSource(team: ForecastingForTest) {
  await team.submit({ form: 'setup', edit: { kind: 'useThese' } })
  return (await team.inputsScreen()).inputs.milestone.ticketsSource
}

describe('finished tickets per period', () => {
  // the 8 whole weeks the read reaches, back 9 weeks from Monday 26 Oct, laid from Saturday 3 Oct
  const WEEKS = ['2026-08-29', '2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17']

  test('a finish late on Friday counts in Friday’s week in the EM’s time zone, though it is Saturday in UTC', async () => {
    // 02:30 UTC on Saturday 17 Oct is 22:30 on Friday 16 Oct in New York
    const finished = [{ id: 'a', finishedAt: '2026-10-17T02:30:00Z' }]

    expect(await periods(await readOf(finished, { timeZone: 'America/New_York' }))).toEqual(dated(WEEKS, [0, 0, 0, 0, 0, 0, 1, 0]))
    expect(await periods(await readOf(finished))).toEqual(dated(WEEKS, [0, 0, 0, 0, 0, 0, 0, 1]))
  })

  test('at a 7-day cadence, each finish counts in its week; quiet weeks are 0 and the current week is left out', async () => {
    const team = await readOf([
      { id: 'a', finishedAt: '2026-09-27T12:00:00Z' }, // before the milestone's start
      { id: 'b', finishedAt: '2026-10-03T00:00:00Z' }, // first day of the week of 3 Oct
      { id: 'c', finishedAt: '2026-10-09T23:59:00Z' }, // last day of the week of 3 Oct
      { id: 'd', finishedAt: '2026-10-19T08:00:00Z' },
      { id: 'e', finishedAt: '2026-10-24T08:00:00Z' }, // the current week
      { id: 'f' },
    ])

    expect(await periods(team)).toEqual(dated(WEEKS, [0, 0, 0, 0, 1, 2, 0, 1]))
  })

  test('at a 14-day cadence, each finish counts in its sprint, laid back from the current sprint', async () => {
    // Sprints from Saturday 5 Sep, the read reaching back 18 weeks: the current one, 17 Oct, holding 26 Oct, is left out
    const team = await readOf(
      [
        { id: 'a', finishedAt: '2026-09-10T10:00:00Z' },
        { id: 'b', finishedAt: '2026-10-05T10:00:00Z' },
        { id: 'c', finishedAt: '2026-10-16T10:00:00Z' },
        { id: 'd', finishedAt: '2026-10-20T10:00:00Z' },
      ],
      { startDate: '2026-09-05', cadenceDays: '14' },
    )

    const SPRINTS = ['2026-06-27', '2026-07-11', '2026-07-25', '2026-08-08', '2026-08-22', '2026-09-05', '2026-09-19', '2026-10-03']
    expect(await periods(team)).toEqual(dated(SPRINTS, [0, 0, 0, 0, 0, 1, 0, 2]))
  })
})

describe('reading a query', () => {
  test('saves the read, replacing the last one, and tickets remaining counts its open tickets', async () => {
    const team = await readOf([{ id: 'a' }])
    expect(await readLine(team)).toBe('1 open · 0 finished in the last 9 weeks')

    team.fixture.reads[CHECKOUT.query] = { tickets: [{ id: 'a' }, { id: 'b', finishedAt: '2026-10-05T10:00:00Z' }, { id: 'c' }], incomplete: false }
    await readAgain(team, '2026-10-26T14:30:00Z')

    expect(await readLine(team)).toBe('2 open · 1 finished in the last 9 weeks')
    expect(await ticketsSource(team)).toMatchObject({ reading: { count: 2 } })
  })

  test('a failed read keeps the saved read', async () => {
    const team = await readOf([{ id: 'a' }, { id: 'b', finishedAt: '2026-10-05T10:00:00Z' }])
    team.fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    // a skip within reach reads the query again, further back
    await skip(team, ['2026-10-10'], '2026-10-27T09:00:00Z')

    expect(team.calls.since).toHaveLength(2)
    expect(await readLine(team)).toBe('1 open · 1 finished in the last 9 weeks')
  })

  test('a failed first read has no saved read', async () => {
    const team = await forecastingForTest({ connected: true, setupOpen: true, clock: { now: READ_AT } })
    team.fixture.reads[CHECKOUT.query] = { failure: 'unauthorised' }

    await pick(team, READ_AT)

    expect(await readLine(team)).toBeUndefined()
    expect(team.storage.teamQueries('current').reads.savedRead({ teamId: TEAM, query: CHECKOUT.query })).toBeUndefined()
    expect((await team.inputsScreen()).inputs.milestone.ticketsSource?.reading).toBeUndefined()
  })
})

describe('how far back a read reaches', () => {
  // Thursday 12 Nov
  const AT = '2026-11-12T09:00:00Z'
  const reachingBack = (cadenceDays = '7') => readOf([{ id: 'a' }], { startDate: '2026-08-10', cadenceDays, readAt: AT })

  test('weekly, 9 weeks: the 8 pace counts and the current one; each skip within reach adds a week', async () => {
    const team = await reachingBack()
    await skip(team, ['2026-10-12', '2026-10-19'], AT)

    expect(team.calls.since).toEqual(['2026-09-10T09:00:00.000Z', '2026-08-27T09:00:00.000Z'])
  })

  test('at a 14-day cadence, in whole weeks: 18 for 9 sprints, and 2 more for each skipped sprint', async () => {
    const team = await reachingBack('14')
    await skip(team, ['2026-10-12'], AT)

    expect(team.calls.since).toEqual(['2026-07-09T09:00:00.000Z', '2026-06-25T09:00:00.000Z'])
  })

  test('a skip older than any window could reach back to doesn’t widen the read', async () => {
    // with one skip, the window could reach back 10 weeks, to 3 Sep; a skip on 31 Aug is older, so nothing is read again
    const team = await reachingBack()
    await skip(team, ['2026-08-31'], AT)
    expect(team.calls.since).toEqual(['2026-09-10T09:00:00.000Z'])

    await countAgain(team, ['2026-08-31'], AT)
    await skip(team, ['2026-09-07'], AT)
    expect(team.calls.since).toEqual(['2026-09-10T09:00:00.000Z', '2026-09-03T09:00:00.000Z'])
  })

  test('read late on the EM’s Sunday, still Sunday in their time zone, it reaches 8 whole weeks there, the first from its first hour', async () => {
    // 02:00 UTC on Monday 9 Nov is 21:00 on Sunday 8 Nov in New York, in the week of 2 Nov there; the read reaches back
    // to 22:00 on Sunday 6 Sep, so the week of 7 Sep is whole, and a finish at 00:30 on Monday 7 Sep counts in it
    const team = await readOf([{ id: 'a', finishedAt: '2026-09-07T04:30:00Z' }], {
      startDate: '2026-08-31',
      readAt: '2026-11-09T02:00:00Z',
      timeZone: 'America/New_York',
    })

    const weeks = await periods(team)
    expect(weeks).toHaveLength(8)
    expect(weeks?.[0]).toEqual({ start: '2026-09-07', milestone: 1 })
    expect(weeks?.slice(1).every(({ milestone }) => milestone === 0)).toBe(true)
  })
})
