import { describe, expect, test } from 'vitest'
import { setupView, submitSetup, type ChosenSource, type SetupEdit } from '../../src/forecast/setup.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, finishedOn, open, TEAM, type TrackerScenario } from '../trackerScenario.js'
import { READ_AT, Q3_POLISH, scenario, team, settingUp } from './setupScenario.js'

// Check (#220): for each value the tracker can supply, the EM's value now, the tracker's reading from the draft reads,
// and which to use. "Use these" applies the draft and the sources chosen together.
describe('Check', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`

  /**
   * A team set up on `to`, its milestone typed as 30 tickets with a pace range of 4–8, following nothing; setup
   * opened again with Change, the milestone query edited there to read 7 open tickets, and Q3 polish, finished 6 in
   * w/c 2 Nov, picked as comparable work.
   */
  async function changedInSetup({ to = 'github', incomplete = false }: { to?: 'github' | 'jira'; incomplete?: boolean } = {}): Promise<TrackerScenario> {
    const { connect, submit, fixture } = team()
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[BOTH] = { tickets: open(7), incomplete }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete }
    await connect(to)
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    await scenario().pick(READ_AT)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    const drafted = scenario().using
    await submitStepQuery(drafted, TEAM, { kind: 'editQuery', query: BOTH }, NEXT_READ_AT)
    await submitStepQuery(drafted, TEAM, { kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)
    return scenario()
  }
  const check = () => (setupView(settingUp(scenario()), TEAM, 'check') as { check?: unknown }).check
  const choose = (...[value, source]: [ChosenSource['value'], ChosenSource['source']]) =>
    submitSetup(settingUp(scenario()), TEAM, { kind: 'chooseSource', value, source } as SetupEdit)

  test('shows the EM’s value now and the draft reading of tickets remaining and pace, each row on its current source', async () => {
    await changedInSetup()

    expect(check()).toMatchObject({
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
    const { submit, storage } = await changedInSetup()
    submit({ kind: 'setPaceCounts', counts: '5 6 7' })
    submit({ kind: 'setPaceMode', paceMode: 'counts' })

    expect(check()).toMatchObject({ pace: { yours: { source: 'counts', counts: [5, 6, 7] }, source: 'counts', choices: ['tracker', 'range', 'counts'] } })
    expect(await choose('pace', 'range')).toMatchObject({ saved: true })
    expect(check()).toMatchObject({ pace: { yours: { source: 'range', range: { low: 4, high: 8 } }, source: 'range' } })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ paceMode: 'range', paceCounts: [5, 6, 7] })
  })

  test('is shown only at Check', async () => {
    await changedInSetup()

    expect(setupView(settingUp(scenario()), TEAM, 'comparableWork')).not.toHaveProperty('check')
  })

  test('choosing the tracker for tickets and keeping the range for pace changes nothing until "Use these", which saves those sources and the draft together', async () => {
    const { storage, inputs, forecast } = await changedInSetup()
    const before = { inputs: inputs(), forecast: forecast() }

    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ saved: true })
    expect(await choose('pace', 'range')).toMatchObject({ saved: true })
    expect(check()).toMatchObject({ ticketsRemaining: { source: 'tracker' }, pace: { source: 'range' } })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)

    expect(await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })).toMatchObject({ saved: true })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'tracker', ticketsRemaining: 30, paceMode: 'range', paceRange: { low: 4, high: 8 } })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(BOTH)
    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'tracker', reading: { count: 7 } })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
  })

  test('the tracker chosen for pace and typed for tickets: pace follows the tracker, and tickets stay as typed', async () => {
    const { storage, inputs } = await changedInSetup()
    await choose('pace', 'tracker')
    await choose('ticketsRemaining', 'typed')
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })

    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed', ticketsRemaining: 30, paceMode: 'tracker', paceRange: { low: 4, high: 8 } })
    expect(inputs().milestone).toMatchObject({ paceUsed: 'tracker', ticketsRemaining: 30 })
  })

  test('keeps the choices made there through Back, and Cancel discards them', async () => {
    const { storage } = await changedInSetup()
    await choose('ticketsRemaining', 'tracker')
    await choose('pace', 'tracker')

    expect(setupView(settingUp(scenario()), TEAM, 'comparableWork')).toMatchObject({ step: 'comparableWork' })
    expect(check()).toMatchObject({ ticketsRemaining: { source: 'tracker' }, pace: { source: 'tracker' } })

    await submitSetup(settingUp(scenario()), TEAM, { kind: 'cancel' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed', paceMode: 'range' })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    expect(check()).toMatchObject({ ticketsRemaining: { source: 'typed', reading: 3 }, pace: { source: 'range' } })
  })

  test('refuses a source it doesn’t offer, changing nothing', async () => {
    const { storage } = await changedInSetup()
    const draft = storage.setupDraft(TEAM)

    expect(await choose('pace', 'counts')).toMatchObject({ saved: false })
    expect(storage.setupDraft(TEAM)).toEqual(draft)
  })

  test('refuses a choice once setup is closed', async () => {
    const { storage } = await changedInSetup()
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })

    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ saved: false })
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed' })
  })

  test('marks an incomplete draft read on its row', async () => {
    await changedInSetup({ incomplete: true })

    expect(check()).toMatchObject({ ticketsRemaining: { reading: 7, incomplete: true }, pace: { incomplete: true } })
    expect(check()).not.toHaveProperty('pace.reading')
  })

  test('names the team’s tracker, Jira', async () => {
    await changedInSetup({ to: 'jira' })

    expect(check()).toMatchObject({ tracker: 'Jira' })
  })

  test('with no milestone entered yet, starts on a new milestone’s sources, and "Use these" saves those chosen', async () => {
    const { connect, storage } = team()
    await connect()
    await scenario().pick(READ_AT)

    expect(check()).toMatchObject({ ticketsRemaining: { reading: 0, source: 'typed' }, pace: { source: 'range', choices: ['tracker', 'range'] } })
    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ saved: true })
    expect(await choose('pace', 'tracker')).toMatchObject({ saved: true })
    expect(storage.milestoneInputs(TEAM)).toBeUndefined()

    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ name: '', ticketsSource: 'tracker', paceMode: 'tracker' })
  })

  test('with no start date yet, says pace has none to count its periods from; once entered, reads pace from the tracker', async () => {
    const { connect, submit, fixture } = team()
    fixture.reads[CHECKOUT.query] = { tickets: [...open(3), ...finishedOn('f', '2026-11-03', 6)], incomplete: false }
    await connect()
    await scenario().pick(READ_AT)

    expect(check()).toMatchObject({ pace: { incomplete: false, noStartDate: true } })
    expect(check()).not.toHaveProperty('pace.reading')

    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining: '30' })
    expect(check()).toMatchObject({ pace: { reading: { counts: [6] }, noStartDate: false } })
  })

  test('with no milestone entered yet and its sources left as they start, "Use these" enters no milestone', async () => {
    const { connect, storage } = team()
    await connect()
    await scenario().pick(READ_AT)
    await choose('ticketsRemaining', 'typed')

    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toBeUndefined()
  })
})
