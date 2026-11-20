import { beforeEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import type { InputsEdit } from '../../src/forecast/index.js'
import { CHECKOUT, finishedInWeeks as finishedInWeeksOf, open } from '../trackerScenario.js'
import { checkoutFixture, CONNECTIONS, forecastingForTest, NOW, pick, readAgain, type ForecastingForTest } from './forecastingForTest.js'

// A typed value the tracker reads differently (#215): its chip, the dot on it for a read the EM hasn't opened, and
// Follow, which switches the value back to the tracker. Mirrors the prototype's `handNew` scenario.

// Thursday 12 Nov, today; the read reaches back 8 weeks, to 09:00 on Thursday 17 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
const NEXT_READ_AT = '2026-11-12T14:30:00Z'
const START = '2026-08-31'

// The weeks the read reaches whole, from Monday 21 Sep; the current week, of 9 Nov, is left out.
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] => finishedInWeeksOf(WEEKS, counts)

// GitHub reads 34 tickets remaining, and 5, 6, 4, 7, 5, 6, 8 finished in the weeks it reads whole
const GITHUB_COUNTS = [5, 6, 4, 7, 5, 6, 8]

const OFFLINE = { connected: false }

const TICKETS = [...open(34), ...finishedInWeeks(GITHUB_COUNTS)]

let team: ForecastingForTest

beforeEach(async () => {
  team = await forecastingForTest({ fixture: checkoutFixture(TICKETS) })
})

/** Each as the local server build shows it, with the tracker's reads; `OFFLINE` as the browser build does. */
const build = (shown?: { connected: boolean }) => (shown?.connected === false ? team.browserBuild() : team)

const submit = (edit: InputsEdit, shown?: { connected: boolean }) => build(shown).submit({ form: 'inputs', edit })

const inputs = async (shown?: { connected: boolean }) => (await build(shown).inputsScreen()).inputs

const forecast = (shown?: { connected: boolean }) => build(shown).milestoneForecastView()

const connect = (to: 'github' | 'jira' = 'github') => team.submit({ form: 'connection', edit: CONNECTIONS[to] })

/** The milestone, `ticketsRemaining` typed, with typed counts and a range kept, its tickets picked and read. */
async function enterAndPick(ticketsRemaining = '40'): Promise<void> {
  await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining })
  await submit({ kind: 'setPaceRange', low: '4', high: '8' })
  await submit({ kind: 'setPaceCounts', counts: '5, 6, 4, 7, 5, 6' })
  await pick(team, READ_AT)
}

describe('tickets remaining', () => {
  beforeEach(async () => {
    await connect()
    await enterAndPick()
  })

  test('typed and different from GitHub’s reading, it carries the chip, with the dot for a read not yet opened', async () => {
    expect((await inputs()).milestone.ticketsSource).toMatchObject({ source: 'typed', reading: { count: 34 }, readsDifferently: { unseen: true } })
  })

  test('typed the same as GitHub’s reading, it carries no chip', async () => {
    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '34' })

    expect((await inputs()).milestone.ticketsSource?.readsDifferently).toBeUndefined()
  })

  test('following GitHub, it carries no chip', async () => {
    await submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect((await inputs()).milestone.ticketsSource?.readsDifferently).toBeUndefined()
  })

  test('opening the reading clears the dot, which returns with a new read', async () => {
    expect(await submit({ kind: 'openReading', reading: 'ticketsRemaining' })).toEqual({ kind: 'saved', next: { screen: 'inputs' } })
    expect((await inputs()).milestone.ticketsSource?.readsDifferently).toEqual({ unseen: false })

    team.fixture.reads[CHECKOUT.query] = { tickets: open(38), incomplete: false }
    await readAgain(team, NEXT_READ_AT)

    expect((await inputs()).milestone.ticketsSource).toMatchObject({ reading: { count: 38 }, readsDifferently: { unseen: true } })
  })

  test('Follow switches it back to GitHub, keeping the typed value', async () => {
    await submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(await forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 34 })
    await submit({ kind: 'setTicketsSource', ticketsSource: 'typed' })
    expect((await inputs()).milestone).toMatchObject({ ticketsRemaining: 40, ticketsSource: { readsDifferently: { unseen: true } } })
  })
})

describe('pace', () => {
  beforeEach(async () => {
    await connect()
    await enterAndPick()
  })

  test('typed counts different from GitHub’s carry the chip, with its dot', async () => {
    await submit({ kind: 'setPaceMode', paceMode: 'counts' })

    expect((await inputs()).milestone.trackerPace).toMatchObject({ reading: { counts: GITHUB_COUNTS }, readsDifferently: { unseen: true } })
  })

  test('typed counts the same as GitHub’s carry no chip', async () => {
    await submit({ kind: 'setPaceMode', paceMode: 'counts' })
    await submit({ kind: 'setPaceCounts', counts: GITHUB_COUNTS.join(', ') })

    expect((await inputs()).milestone.trackerPace?.readsDifferently).toBeUndefined()
  })

  test('a range other than the span of GitHub’s counts carries the chip; one spanning them, 4 to 8, carries none', async () => {
    expect((await inputs()).milestone).toMatchObject({ paceMode: 'range', paceRange: { low: 4, high: 8 } })
    expect((await inputs()).milestone.trackerPace?.readsDifferently).toBeUndefined()

    await submit({ kind: 'setPaceRange', low: '4', high: '9' })

    expect((await inputs()).milestone.trackerPace?.readsDifferently).toEqual({ unseen: true })
  })

  test('following GitHub, pace carries no chip', async () => {
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })

    expect((await inputs()).milestone.trackerPace?.readsDifferently).toBeUndefined()
  })

  test('opening the reading clears the dot, which returns with a new read', async () => {
    await submit({ kind: 'setPaceMode', paceMode: 'counts' })

    await submit({ kind: 'openReading', reading: 'pace' })
    expect((await inputs()).milestone.trackerPace?.readsDifferently).toEqual({ unseen: false })
    // opening pace’s reading leaves tickets remaining’s dot
    expect((await inputs()).milestone.ticketsSource?.readsDifferently).toEqual({ unseen: true })

    await readAgain(team, NEXT_READ_AT)
    expect((await inputs()).milestone.trackerPace?.readsDifferently).toEqual({ unseen: true })
  })

  test('Follow switches pace back to GitHub, keeping the typed counts and the range', async () => {
    await submit({ kind: 'setPaceMode', paceMode: 'counts' })

    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })

    expect(await forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', counts: GITHUB_COUNTS } })
    expect((await inputs()).milestone).toMatchObject({ paceCounts: [5, 6, 4, 7, 5, 6], paceRange: { low: 4, high: 8 } })
  })
})

describe('a reading that can’t be opened', () => {
  test('with no connection, there is no chip, and opening a reading is refused', async () => {
    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' }, OFFLINE)

    expect((await inputs(OFFLINE)).milestone).toMatchObject({ ticketsSource: undefined, trackerPace: undefined })
    expect(await submit({ kind: 'openReading', reading: 'ticketsRemaining' }, OFFLINE)).toMatchObject({
      kind: 'refused',
      view: { inputs: { refusal: { form: 'readingOpened', error: 'Connect a tracker to see its reading.' } } },
    })
  })

  test('before the milestone’s tickets are read, there is no chip', async () => {
    await connect()
    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })

    expect((await inputs()).milestone.ticketsSource?.readsDifferently).toBeUndefined()
    expect(await submit({ kind: 'openReading', reading: 'ticketsRemaining' })).toMatchObject({
      kind: 'refused',
      view: { inputs: { refusal: { form: 'readingOpened', error: 'GitHub hasn’t read it yet.' } } },
    })
  })
})

describe('on Jira', () => {
  test('the chip’s reading and Follow name Jira', async () => {
    await connect('jira')
    const release: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'fixVersion = "Checkout v2"' }
    team.fixture.reads[release.query] = { tickets: open(12), incomplete: false }
    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await pick(team, READ_AT, release)

    expect((await inputs()).milestone.ticketsSource).toMatchObject({ tracker: 'Jira', readsDifferently: { unseen: true } })
  })
})
