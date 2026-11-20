import { describe, expect, test } from 'vitest'
import type { SetupEdit } from '../../src/forecast/index.js'
import { finishedOn, open } from '../trackerScenario.js'
import { CHECKOUT, pick, TEAM, type ForecastingForTest, submitInputs } from './forecastingForTest.js'
import { READ_AT, Q3_POLISH, connect, inputs, setup, setupAt, stepQuery, team } from './setupScenario.js'

// Check (#220): for each value the tracker can supply, the EM's value now, the tracker's reading from the draft reads,
// and which to use. "Use these" applies the draft and the sources chosen together.
describe('Check', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`
  type ChosenSource = Omit<Extract<SetupEdit, { kind: 'chooseSource' }>, 'kind'>

  let current: ForecastingForTest

  /**
   * A team set up on `to`, its milestone typed as 30 tickets with a pace range of 4–8, following nothing; setup
   * opened again with Change, the milestone query edited there to read 7 open tickets, and Q3 polish, finished 6 in
   * w/c 2 Nov, picked as comparable work.
   */
  async function changedInSetup({ to = 'github', incomplete = false }: { to?: 'github' | 'jira'; incomplete?: boolean } = {}): Promise<ForecastingForTest> {
    current = await team()
    const { fixture } = current
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[BOTH] = { tickets: open(7), incomplete }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete }
    await connect(current, to)
    await submitInputs(current, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    await submitInputs(current, { kind: 'setPaceRange', low: '4', high: '8' })
    await pick(current, READ_AT)
    await setup(current, { kind: 'useThese' })
    await setup(current, { kind: 'change' })
    await stepQuery(current, { kind: 'editQuery', query: BOTH }, 'milestone', NEXT_READ_AT)
    await stepQuery(current, { kind: 'addPick', choice: Q3_POLISH }, 'comparableWork')
    return current
  }
  const check = async () => {
    const view = await setupAt(current, 'check')
    return view?.kind === 'steps' ? view.check : undefined
  }
  const choose = (...[value, source]: [ChosenSource['value'], ChosenSource['source']]) => setup(current, { kind: 'chooseSource', value, source } as SetupEdit)

  test('shows the EM’s value now and the draft reading of tickets remaining and pace, each row on its current source', async () => {
    await changedInSetup()

    expect(await check()).toMatchObject({
      tracker: 'GitHub',
      ticketsRemaining: { yours: 30, reading: 7, incomplete: false, source: 'typed' },
      pace: {
        yours: { source: 'range', range: { low: 4, high: 8 } },
        reading: { counts: [6] },
        incomplete: false,
        source: 'range',
        choices: ['tracker', 'range'],
      },
    })
  })

  test('offers the range beside the typed counts when pace is the EM’s typed counts, Yours showing the one chosen', async () => {
    const { storage } = await changedInSetup()
    await submitInputs(current, { kind: 'setPaceCounts', counts: '5 6 7' })
    await submitInputs(current, { kind: 'setPaceMode', paceMode: 'counts' })

    expect(await check()).toMatchObject({ pace: { yours: { source: 'counts', counts: [5, 6, 7] }, source: 'counts', choices: ['tracker', 'range', 'counts'] } })
    expect(await choose('pace', 'range')).toMatchObject({ kind: 'saved' })
    expect(await check()).toMatchObject({ pace: { yours: { source: 'range', range: { low: 4, high: 8 } }, source: 'range' } })
    await setup(current, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ paceMode: 'range', paceCounts: [5, 6, 7] })
  })

  test('is shown only at Check', async () => {
    await changedInSetup()

    expect(await setupAt(current, 'comparableWork')).not.toHaveProperty('check')
  })

  test('choosing the tracker for tickets and keeping the range for pace changes nothing until "Use these", which saves those sources and the draft together', async () => {
    const { storage } = await changedInSetup()
    const before = { inputs: await inputs(current), forecast: await current.milestoneForecastView() }

    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ kind: 'saved' })
    expect(await choose('pace', 'range')).toMatchObject({ kind: 'saved' })
    expect(await check()).toMatchObject({ ticketsRemaining: { source: 'tracker' }, pace: { source: 'range' } })
    expect(await inputs(current)).toEqual(before.inputs)
    expect(await current.milestoneForecastView()).toEqual(before.forecast)

    expect(await setup(current, { kind: 'useThese' })).toMatchObject({ kind: 'saved' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'tracker', ticketsRemaining: 30, paceMode: 'range', paceRange: { low: 4, high: 8 } })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(BOTH)
    expect((await inputs(current)).milestone.ticketsSource).toMatchObject({ source: 'tracker', reading: { count: 7 } })
    expect(await current.milestoneForecastView()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
  })

  test('the tracker chosen for pace and typed for tickets: pace follows the tracker, and tickets stay as typed', async () => {
    const { storage } = await changedInSetup()
    await choose('pace', 'tracker')
    await choose('ticketsRemaining', 'typed')
    await setup(current, { kind: 'useThese' })

    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed', ticketsRemaining: 30, paceMode: 'tracker', paceRange: { low: 4, high: 8 } })
    expect((await inputs(current)).milestone).toMatchObject({ paceUsed: 'tracker', ticketsRemaining: 30 })
  })

  test('keeps the choices made there through Back, and Cancel discards them', async () => {
    const { storage } = await changedInSetup()
    await choose('ticketsRemaining', 'tracker')
    await choose('pace', 'tracker')

    expect(await setupAt(current, 'comparableWork')).toMatchObject({ step: 'comparableWork' })
    expect(await check()).toMatchObject({ ticketsRemaining: { source: 'tracker' }, pace: { source: 'tracker' } })

    await setup(current, { kind: 'cancel' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed', paceMode: 'range' })
    await setup(current, { kind: 'change' })
    expect(await check()).toMatchObject({ ticketsRemaining: { source: 'typed', reading: 3 }, pace: { source: 'range' } })
  })

  test('refuses a source it doesn’t offer, changing nothing', async () => {
    const { storage } = await changedInSetup()
    const draft = storage.setupDraft(TEAM)

    await choose('pace', 'counts')
    expect(storage.setupDraft(TEAM)).toEqual(draft)
    expect(await check()).toMatchObject({ pace: { source: 'range' } })
  })

  test('refuses a choice once setup is closed', async () => {
    const { storage } = await changedInSetup()
    await setup(current, { kind: 'useThese' })

    await choose('ticketsRemaining', 'tracker')
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed' })
  })

  test('marks an incomplete draft read on its row', async () => {
    await changedInSetup({ incomplete: true })

    expect(await check()).toMatchObject({ ticketsRemaining: { reading: 7, incomplete: true }, pace: { incomplete: true } })
    expect(await check()).not.toHaveProperty('pace.reading')
  })

  test('names the team’s tracker, Jira', async () => {
    await changedInSetup({ to: 'jira' })

    expect(await check()).toMatchObject({ tracker: 'Jira' })
  })

  test('with no milestone entered yet, starts on a new milestone’s sources, and "Use these" saves those chosen', async () => {
    current = await team()
    const { storage } = current
    await connect(current)
    await pick(current, READ_AT)

    expect(await check()).toMatchObject({ ticketsRemaining: { reading: 0, source: 'typed' }, pace: { source: 'range', choices: ['tracker', 'range'] } })
    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ kind: 'saved' })
    expect(await choose('pace', 'tracker')).toMatchObject({ kind: 'saved' })
    expect(storage.milestoneInputs(TEAM)).toBeUndefined()

    await setup(current, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ name: '', ticketsSource: 'tracker', paceMode: 'tracker' })
  })

  test('with no start date yet, says pace has none to count its periods from; once entered, reads pace from the tracker', async () => {
    current = await team()
    current.fixture.reads[CHECKOUT.query] = { tickets: [...open(3), ...finishedOn('f', '2026-11-03', 6)], incomplete: false }
    await connect(current)
    await pick(current, READ_AT)

    expect(await check()).toMatchObject({ pace: { incomplete: false, noStartDate: true } })
    expect(await check()).not.toHaveProperty('pace.reading')

    await submitInputs(current, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining: '30' })
    expect(await check()).toMatchObject({ pace: { reading: { counts: [6] }, noStartDate: false } })
  })

  test('with no milestone entered yet and its sources left as they start, "Use these" enters no milestone', async () => {
    current = await team()
    const { storage } = current
    await connect(current)
    await pick(current, READ_AT)
    await choose('ticketsRemaining', 'typed')

    await setup(current, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toBeUndefined()
  })
})
