import { beforeEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import type { InputsEdit } from '../../src/forecast/index.js'
import { finishedInWeeks as finishedInWeeksOf } from '../trackerScenario.js'
import { CHECKOUT, checkoutFixture, CONNECTIONS, forecastingForTest, pick, type ForecastingForTest } from './forecastingForTest.js'

// Pace following the tracker from the milestone's own finished tickets, which count only in the periods since its
// start date: what the reading and its problem say of those before it (#405).

// Thursday 12 Nov, today; at the weekly cadence the read reaches back 9 weeks, to Thursday 10 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
// a Monday, long before the read reaches
const START = '2026-08-31'

// The weeks the read reaches whole, from Monday 14 Sep; the current week, of 9 Nov, is left out.
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] => finishedInWeeksOf(WEEKS, counts)

const OPEN: Ticket[] = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]

let team: ForecastingForTest

beforeEach(async () => {
  team = await forecastingForTest({ fixture: checkoutFixture(OPEN) })
  await team.submit({ form: 'connection', edit: CONNECTIONS.github })
})

const submit = (edit: InputsEdit) => team.submit({ form: 'inputs', edit })

const inputs = async () => (await team.inputsScreen()).inputs

const forecast = () => team.milestoneForecastView()

/** Pace following GitHub, whose read of the milestone query finished `tickets`, the milestone started on `START`. */
async function following(tickets: Ticket[]): Promise<void> {
  team.fixture.reads[CHECKOUT.query] = { tickets: [...OPEN, ...tickets], incomplete: false }
  await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  await submit({ kind: 'setCadence', cadenceDays: '7' })
  await pick(team, READ_AT)
  await submit({ kind: 'setPaceMode', paceMode: 'tracker' })
}

describe('the milestone’s own pace from its start date', () => {
  test('the milestone’s own pace counts only the periods since its start date, and says so', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))

    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining: '30' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [4, 7, 5, 6, 8],
      line: '5 weeks · since the start date · read 12 Nov 09:00',
      firstFinished: undefined,
    })
  })

  // #405: a start date in the current week, as today's is (a new milestone's), leaves no whole weeks of its own yet
  test('with no week ended since the start date, it says what GitHub finished before it, which doesn’t count', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))

    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-09', ticketsRemaining: '30' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [],
      line: 'no week since the start date has ended · GitHub finished 44 before it · read 12 Nov 09:00',
    })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        {
          input: 'pace',
          message:
            'The milestone’s own pace counts only the weeks since its start date, and none has ended yet: the 44 tickets GitHub finished before it don’t count. Add comparable work, type counts, or switch pace to the range.',
        },
      ],
    })
  })

  test('with nothing finished in the weeks since the start date, it says what GitHub finished before it', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 0, 0]))

    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-26', ticketsRemaining: '30' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [],
      line: 'nothing finished in the 2 weeks since the start date · GitHub finished 30 before it · read 12 Nov 09:00',
    })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        {
          input: 'pace',
          message:
            'The milestone’s own pace counts only the weeks since its start date, and nothing finished in them: the 30 tickets GitHub finished before it don’t count. Add comparable work, type counts, or switch pace to the range.',
        },
      ],
    })
  })

  test('with no week ended since the start date and nothing finished before it, it says so', async () => {
    await following([])

    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-09', ticketsRemaining: '30' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      line: 'no week since the start date has ended · GitHub finished none before it · read 12 Nov 09:00',
    })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        {
          input: 'pace',
          message:
            'The milestone’s own pace counts only the weeks since its start date, and none has ended yet. Add comparable work, type counts, or switch pace to the range.',
        },
      ],
    })
  })

  test('with no week ended since the start date and comparable work that finished nothing, it doesn’t offer to add comparable work', async () => {
    const like: Choice = { kind: 'label', name: 'checkout-like', query: 'label:"checkout-like"' }
    team.fixture.milestoneChoices = [
      { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
      { kind: 'label', choices: [like], pastLimit: false },
    ]
    team.fixture.reads[like.query] = { tickets: [{ id: 'like-open' }], incomplete: false }
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))
    await pick(team, READ_AT, like, 'comparableWork')

    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-09', ticketsRemaining: '30' })

    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        {
          input: 'pace',
          message:
            'The milestone’s own pace counts only the weeks since its start date, and none has ended yet: the 44 tickets GitHub finished before it don’t count. Type counts, or switch pace to the range.',
        },
      ],
    })
  })
})
