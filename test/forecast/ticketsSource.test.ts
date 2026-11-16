import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import type { InputsEdit } from '../../src/forecast/inputs.js'
import { CHECKOUT, TEAM, trackerScenario, type Shown, type TrackerScenario } from '../trackerScenario.js'

// Tickets remaining's source (#211): following the tracker's latest read of the milestone query, or typed.

// on Thursday 12 Nov, today
const READ_AT = '2026-11-12T09:00:00Z'
const NEXT_READ_AT = '2026-11-12T14:30:00Z'

const open = (...ids: string[]): Ticket[] => ids.map((id) => ({ id }))
const FINISHED: Ticket[] = [{ id: 'f1', finishedAt: '2026-10-20T10:00:00Z' }]

const OFFLINE = { connected: false }

let scenario: TrackerScenario

beforeEach(() => {
  scenario = trackerScenario({ tickets: [...open('m1', 'm2', 'm3'), ...FINISHED] })
})

afterEach(() => scenario.close())

const connectGitHub = () => scenario.connect()

/** The milestone, 30 tickets typed, at 4–8 a week, with its tickets picked in the Milestone step and read. */
async function enterAndPick(): Promise<void> {
  submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
  submit({ kind: 'setPaceRange', low: '4', high: '8' })
  await scenario.pick(READ_AT)
}

// each as the local server build shows it, with the tracker's reads; `OFFLINE` as the browser build does
const submit = (edit: InputsEdit, shown?: Shown) => scenario.submit(edit, shown)

const inputs = (shown?: Shown) => scenario.inputs(shown)

const forecast = (shown?: Shown) => scenario.forecast(shown)

describe('following the tracker', () => {
  beforeEach(async () => {
    await connectGitHub()
    await enterAndPick()
  })

  test('tickets remaining is typed until the EM chooses the tracker, which offers GitHub’s reading beside it', () => {
    expect(inputs().milestone.ticketsSource).toEqual({
      source: 'typed',
      tracker: 'GitHub',
      reading: { count: 3, incomplete: false, readOn: '12 Nov 09:00', readAt: READ_AT },
      readsDifferently: { unseen: true },
    })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })
  })

  test('following GitHub, tickets remaining is its latest read’s, which the forecast uses', () => {
    expect(submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })).toEqual({ saved: true, next: 'inputs' })

    expect(inputs().milestone.ticketsSource).toEqual({
      source: 'tracker',
      tracker: 'GitHub',
      reading: { count: 3, incomplete: false, readOn: '12 Nov 09:00', readAt: READ_AT },
    })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })
  })

  test('each read updates it, with no question asked', async () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    scenario.fixture.reads[CHECKOUT.query] = { tickets: open('m1', 'm2', 'm3', 'm4', 'm5'), incomplete: false }

    await scenario.readAgain(NEXT_READ_AT)

    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'tracker', reading: { count: 5, readOn: '12 Nov 14:30' } })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 5 })
  })

  test('saving the milestone’s name while following, with no tickets remaining on the form, keeps following', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(submit({ kind: 'setMilestone', name: 'Checkout v3', startDate: '2026-11-16', ticketsRemaining: undefined })).toEqual({ saved: true, next: 'inputs' })

    expect(inputs().milestone).toMatchObject({ name: 'Checkout v3', ticketsSource: { source: 'tracker' } })
    expect(forecast()).toMatchObject({ kind: 'forecast', name: 'Checkout v3', ticketsRemaining: 3 })
  })

  test('typing tickets remaining switches it to typed', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '40' })

    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'typed' })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 40 })
  })

  test('the typed value is kept while following, and back again once typed is chosen', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    expect(inputs().forms.milestone.ticketsRemaining).toBe('30')

    submit({ kind: 'setTicketsSource', ticketsSource: 'typed' })

    expect(inputs().milestone).toMatchObject({ ticketsRemaining: 30, ticketsSource: { source: 'typed' } })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })
  })

  test('a source that isn’t offered is refused, saying why', () => {
    const submitted = submit({ kind: 'setTicketsSource', ticketsSource: 'guess' })

    expect(submitted).toMatchObject({ saved: false, screen: 'inputs', view: { refusal: { form: 'ticketsSource', error: 'Choose GitHub or typed.' } } })
  })
})

describe('a read that can’t be followed', () => {
  beforeEach(connectGitHub)

  test('an incomplete read’s count is marked incomplete, and the forecast doesn’t use it as if whole', async () => {
    scenario.fixture.reads[CHECKOUT.query] = { tickets: open('m1', 'm2'), incomplete: true }
    await enterAndPick()

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    const why = 'GitHub gave only part of the milestone’s tickets, so tickets remaining isn’t known. Narrow the milestone query, or type tickets remaining.'
    expect(inputs().milestone).toMatchObject({
      ticketsSource: { source: 'tracker', reading: { count: 2, incomplete: true } },
      notes: [{ input: 'ticketsRemaining', message: why }],
    })
    expect(forecast()).toEqual({ kind: 'problems', name: 'Checkout v2', problems: [{ input: 'ticketsRemaining', message: why }] })
  })

  test('with the milestone’s tickets not read yet, there is no reading, and following it gives no forecast until there is', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(inputs().milestone.ticketsSource).toEqual({ source: 'tracker', tracker: 'GitHub', reading: undefined })
    expect(forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        { input: 'ticketsRemaining', message: 'GitHub hasn’t read the milestone’s tickets yet. Pick them in the Milestone step, or type tickets remaining.' },
      ],
    })
  })
})

describe('with no connection', () => {
  test('tickets remaining is typed, as in the MVP, with no source to choose', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' }, OFFLINE)

    expect(inputs(OFFLINE).milestone).toMatchObject({ ticketsRemaining: 30, ticketsSource: undefined })
  })

  test('the tracker can’t be chosen', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' }, OFFLINE)

    expect(submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' }, OFFLINE)).toMatchObject({
      saved: false,
      view: { refusal: { form: 'ticketsSource', error: 'Connect a tracker to follow it.' } },
    })
  })

  test('once disconnected, a milestone that followed the tracker forecasts from its typed tickets remaining', async () => {
    await connectGitHub()
    await enterAndPick()
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    await submitConnection(scenario.using, TEAM, { kind: 'disconnect' })

    expect(inputs().milestone.ticketsSource).toBeUndefined()
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })
  })
})

describe('on Jira', () => {
  const release: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'fixVersion = "Checkout v2"' }

  beforeEach(async () => {
    await scenario.connect('jira')
    scenario.fixture.reads[release.query] = { tickets: open('j1', 'j2'), incomplete: true }
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    await scenario.pick(READ_AT, release)
  })

  test('the sources and their wording name Jira', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(inputs().milestone.ticketsSource).toMatchObject({ tracker: 'Jira' })
    expect(forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'ticketsRemaining', message: expect.stringMatching(/^Jira gave only part of the milestone’s tickets/) }],
    })
    expect(submit({ kind: 'setTicketsSource', ticketsSource: 'guess' })).toMatchObject({ view: { refusal: { error: 'Choose Jira or typed.' } } })
  })
})
