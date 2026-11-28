import { beforeEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import type { InputsEdit } from '../../src/forecast/index.js'
import { addDay, finishedInWeeks as finishedInWeeksOf, finishedOn } from '../trackerScenario.js'
import { CHECKOUT, checkoutFixture, CONNECTIONS, forecastingForTest, pick, readAgain, skip, type ForecastingForTest } from './forecastingForTest.js'

// Pace from finished comparable work (#411): with no open tickets in comparable work's latest read, the window ends at
// the period of its last finished ticket, as it starts at the first's.

// Thursday 12 Nov; the 8 whole weeks the read reaches, the current one, of 9 Nov, left out
const READ_AT = '2026-11-12T09:00:00Z'
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
const finishedInWeeks = (counts: number[], prefix?: string): Ticket[] => finishedInWeeksOf(WEEKS, counts, prefix)

const LIKE: Choice = { kind: 'label', name: 'checkout-like', query: 'label:"checkout-like"' }
// comparable work finished in weeks 3–5 of the 8, on their Tuesdays: the last on 13 Oct
const LIKE_FINISHED = finishedInWeeks([0, 0, 2, 3, 4, 0, 0, 0], 'like')

let team: ForecastingForTest

beforeEach(async () => {
  team = await forecastingForTest({ fixture: checkoutFixture([{ id: 'o1' }, ...finishedInWeeks([0, 0, 1, 0, 0, 0, 0, 0])]) })
  await team.submit({ form: 'connection', edit: CONNECTIONS.github })
  team.fixture.milestoneChoices = [
    { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
    { kind: 'label', choices: [LIKE], pastLimit: false },
  ]
  const edit = (edit: InputsEdit) => team.submit({ form: 'inputs', edit })
  await edit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-08-31', ticketsRemaining: '30' })
  await edit({ kind: 'setCadence', cadenceDays: '7' })
  await edit({ kind: 'setPaceMode', paceMode: 'tracker' })
  await pick(team, READ_AT)
})

/** Comparable work reads `tickets`, picked at the read. */
async function comparableWork(tickets: Ticket[]): Promise<void> {
  team.fixture.reads[LIKE.query] = { tickets, incomplete: false }
  await pick(team, READ_AT, LIKE, 'comparableWork')
}

const reading = async () => (await team.inputsScreen()).inputs.milestone.trackerPace?.reading

describe('comparable work with no open tickets', () => {
  test('finished in weeks 3–5 of 8, pace counts weeks 3–5, and says it stops at the last finished ticket', async () => {
    await comparableWork(LIKE_FINISHED)

    expect(await reading()).toMatchObject({
      counts: [2, 3, 4],
      line: '3 weeks · read 12 Nov 09:00',
      firstFinished: 'From the first finished ticket, 28 Sep.',
      lastFinished: 'To the last finished ticket, 13 Oct: comparable work has no open tickets.',
    })
  })

  test('the forecast runs on the shorter window, and says where it stops', async () => {
    // finished in weeks 2–5, the last on 13 Oct
    await comparableWork(finishedInWeeks([0, 2, 3, 4, 5, 0, 0, 0], 'like'))

    expect(await team.milestoneForecastView()).toMatchObject({
      kind: 'forecast',
      pace: { source: 'tracker', counts: [2, 3, 4, 5], lastFinished: 'To the last finished ticket, 13 Oct: comparable work has no open tickets.' },
      paceSaid: 'GitHub’s 4 weeks',
    })
  })

  test('a week skipped within it is a gap, and the weeks after its last finished ticket stay left out', async () => {
    await comparableWork(LIKE_FINISHED)
    await skip(team, ['2026-10-05'], READ_AT)

    expect(await reading()).toMatchObject({
      periods: [
        { start: '2026-09-28', count: 2, skipped: false },
        { start: '2026-10-05', count: 3, skipped: true },
        { start: '2026-10-12', count: 4, skipped: false },
      ],
      counts: [2, 4],
    })
  })
})

describe('at a 1-day cadence, comparable work finished before the read’s reach from today (#424)', () => {
  // a ticket finished each day from 19 Oct to 30 Oct; read on 12 Nov, a 1-day cadence reaches back to 29 Oct alone
  const DAYS = Array.from({ length: 12 }, (_, day) => addDay(`2026-10-${String(18 + day)}`))
  const DAILY = DAYS.flatMap((day) => finishedOn('like', day, 1))
  // the 8 days up to the last finished ticket's, 30 Oct
  const LAST_8 = DAYS.slice(-8)

  beforeEach(async () => {
    await team.submit({ form: 'inputs', edit: { kind: 'setCadence', cadenceDays: '1' } })
  })

  test('picked, pace counts the 8 days up to its last finished ticket, not the 1 its read reached', async () => {
    await comparableWork(DAILY)

    expect(await reading()).toMatchObject({ counts: [1, 1, 1, 1, 1, 1, 1, 1], periods: LAST_8.map((start) => ({ start, count: 1 })) })
  })

  test('read again, the milestone’s query too, it still counts those 8 days', async () => {
    await comparableWork(DAILY)
    await readAgain(team, READ_AT)

    expect(await reading()).toMatchObject({ counts: [1, 1, 1, 1, 1, 1, 1, 1], periods: LAST_8.map((start) => ({ start, count: 1 })) })
  })
})

describe('comparable work with an open ticket', () => {
  test('the weeks after its last finished ticket still count 0, and nothing says it stops', async () => {
    await comparableWork([{ id: 'like-open' }, ...LIKE_FINISHED])

    expect(await reading()).toMatchObject({ counts: [2, 3, 4, 0, 0, 0], lastFinished: undefined })
    const view = await team.milestoneForecastView()
    expect(view).toMatchObject({ kind: 'forecast', pace: { counts: [2, 3, 4, 0, 0, 0] }, paceSaid: 'GitHub’s last 6 weeks' })
    expect(view.kind === 'forecast' && view.pace).not.toHaveProperty('lastFinished')
  })
})

describe('with no comparable work', () => {
  test('the milestone’s own pace runs to the current week, though it has no open tickets', async () => {
    team.fixture.reads[CHECKOUT.query] = { tickets: finishedInWeeks([0, 0, 2, 3, 4, 0, 0, 0]), incomplete: false }
    await readAgain(team, READ_AT)

    expect(await reading()).toMatchObject({ counts: [2, 3, 4, 0, 0, 0], lastFinished: undefined })
  })
})
