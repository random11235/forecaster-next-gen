import { beforeEach, describe, expect, test } from 'vitest'
import type { Ticket } from '../../src/connectors/connector.js'
import { finishedInWeeks, open } from '../trackerScenario.js'
import {
  CHECKOUT,
  checkoutFixture,
  forecastingForTest,
  NOW,
  pick,
  readAgain as readAgainAt,
  type ForecastingForTest,
  submitInputs,
} from './forecastingForTest.js'

// The faint previous value (#214): a value following the tracker shows, faintly, the value the latest read replaced.

// a week before today, Thursday 12 Nov: the read then counted the weeks up to w/c 26 Oct
const FIRST_READ_AT = '2026-11-05T09:05:00Z'
const READ_AT = '2026-11-12T09:12:00Z'
// a Monday, long before the reads reach, so the milestone's own pace counts every week they reach whole
const START = '2026-08-31'

// Mondays of the weeks the reads reach, from 14 Sep
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

/** `remaining` open tickets, and `counts[i]` finished in the week of `WEEKS[i]`. */
const tickets = (remaining: number, counts: number[]): Ticket[] => [...open(remaining), ...finishedInWeeks(WEEKS, counts)]

let scenario: ForecastingForTest

beforeEach(async () => {
  scenario = await forecastingForTest({ fixture: checkoutFixture(tickets(34, [5, 6, 8, 5, 7, 6, 4, 0])), connected: true })
  await submitInputs(scenario, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  await submitInputs(scenario, { kind: 'setPaceRange', low: '4', high: '8' })
  // the first read, a week ago
  await pick(scenario, FIRST_READ_AT)
  // seen today, Thursday 12 Nov
  scenario.at(NOW)
  await submitInputs(scenario, { kind: 'setTicketsSource', ticketsSource: 'tracker' })
  await submitInputs(scenario, { kind: 'setPaceMode', paceMode: 'tracker' })
})

const inputs = async () => (await scenario.inputsScreen()).inputs.milestone

/** The milestone query read again at `readAt`, finding `remaining` open and `counts` finished. */
async function readAgain(readAt = READ_AT, found = tickets(34, [5, 6, 8, 5, 7, 6, 4, 0])): Promise<void> {
  scenario.fixture.reads[CHECKOUT.query] = { tickets: found, incomplete: false }
  await readAgainAt(scenario, readAt)
  // seen today, Thursday 12 Nov
  scenario.at(NOW)
}

describe('a value following the tracker', () => {
  test('after the first read, neither value has a previous one', async () => {
    expect((await inputs()).ticketsSource).toMatchObject({ reading: { count: 34 }, was: undefined })
    expect((await inputs()).trackerPace).toMatchObject({ reading: { line: 'last 8 weeks · read 5 Nov 09:05' }, was: undefined })
  })

  test('a read updates tickets remaining, with the value it replaced and when that was read', async () => {
    await readAgain(READ_AT, tickets(31, [5, 6, 8, 5, 7, 6, 4, 3]))

    expect((await inputs()).ticketsSource).toMatchObject({ reading: { count: 31, readOn: '12 Nov 09:12' }, was: { count: 34, readOn: '5 Nov 09:05' } })
  })

  test('a read updates pace, with the counts pace showed before it: the window as it was then', async () => {
    await readAgain(READ_AT, tickets(31, [5, 6, 8, 5, 7, 6, 4, 3]))

    expect((await inputs()).trackerPace).toMatchObject({
      reading: { counts: [5, 6, 8, 5, 7, 6, 4, 3], line: 'last 8 weeks · read 12 Nov 09:12' },
      // read on 5 Nov, pace counted the weeks it reached whole, up to w/c 26 Oct
      was: { counts: [5, 6, 8, 5, 7, 6, 4], readOn: '5 Nov 09:05' },
    })
  })

  test('a read that changed nothing shows no previous value', async () => {
    await readAgain('2026-11-05T15:00:00Z')

    expect((await inputs()).ticketsSource).toMatchObject({ reading: { readOn: '5 Nov 15:00' }, was: undefined })
    expect((await inputs()).trackerPace).toMatchObject({ reading: { line: 'last 8 weeks · read 5 Nov 15:00' }, was: undefined })
  })

  test('a typed value shows none: only a value following the tracker does', async () => {
    await readAgain(READ_AT, tickets(31, [5, 6, 8, 5, 7, 6, 4, 3]))

    await submitInputs(scenario, { kind: 'setTicketsSource', ticketsSource: 'typed' })
    await submitInputs(scenario, { kind: 'setPaceMode', paceMode: 'range' })

    expect((await inputs()).ticketsSource).toMatchObject({ source: 'typed', was: undefined })
    expect((await inputs()).trackerPace).toMatchObject({ was: undefined })
  })
})
