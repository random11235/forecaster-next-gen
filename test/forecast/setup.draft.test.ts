import { assert, describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import type { QuerySetupStep, StepQueryEdit } from '../../src/forecast/index.js'
import { finishedOn, open } from '../trackerScenario.js'
import { CHECKOUT, pick, skip, TEAM, type ForecastingForTest, submitInputs } from './forecastingForTest.js'
import { READ_AT, Q3_POLISH, connect, inputs, setup, setupAt, stepQuery, team } from './setupScenario.js'

/** What the step says when Cancel can't put the connection back (lib/setup.ts's NO_CANCEL), written out so the test checks the words, not the constant. */
const NO_CANCEL =
  'The connection changed in these steps, so they can’t be cancelled: Cancel would keep the new connection with the old picks and reads. Go on to Check and use these.'

let current: ForecastingForTest
const forecast = () => current.milestoneForecastView()

// What the EM chooses inside setup (#218) is held as a draft: nothing in it reaches the forecast or the Inputs values
// until "Use these" applies it all together, and Cancel throws it away.
describe('the draft', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`

  /** A team set up on GitHub, following its milestone's 3 open tickets, then setup opened again with Change. */
  async function setUpThenChange(): Promise<ForecastingForTest> {
    current = await team()
    current.fixture.reads[CHECKOUT.query] = {
      tickets: [...open(3), ...finishedOn('f', '2026-11-03', 2), ...finishedOn('g', '2026-10-27', 2)],
      incomplete: false,
    }
    current.fixture.reads[BOTH] = { tickets: open(7), incomplete: false }
    current.fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete: false }
    await connect(current)
    await submitInputs(current, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    await submitInputs(current, { kind: 'setPaceRange', low: '4', high: '8' })
    await submitInputs(current, { kind: 'setTicketsSource', ticketsSource: 'tracker' })
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)
    await setup(current, { kind: 'useThese' })
    await setup(current, { kind: 'change' })
    return current
  }

  /** A query step's submit made inside setup, through the draft. */
  const inSetup = (edit: StepQueryEdit, readAt = NEXT_READ_AT, step: QuerySetupStep = 'milestone') => stepQuery(current, edit, step, readAt)

  /** A query step as setup shows it, through the draft. */
  async function stepInSetup(step: QuerySetupStep = 'milestone') {
    current.at(NEXT_READ_AT)
    return (await current.inputsScreen({ step })).step
  }

  test('picks and a hand-written query made in setup leave the saved queries, saved reads and the forecast unchanged until "Use these"', async () => {
    const { storage } = await setUpThenChange()
    const before = { inputs: await inputs(current), forecast: await forecast() }
    expect(before.forecast).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })

    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, 'comparableWork')

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT], query: CHECKOUT.query })
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.readAt).toBe(READ_AT)
    expect(await inputs(current)).toEqual(before.inputs)
    expect(await forecast()).toEqual(before.forecast)
  })

  test('a first setup’s picks reach nothing either, until "Use these"', async () => {
    current = await team()
    const { storage } = current
    await connect(current)
    const before = await inputs(current)

    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
    expect(await inputs(current)).toEqual(before)
    expect(await setupAt(current)).toMatchObject({ step: 'milestone', next: { step: 'comparableWork' } })
    await setup(current, { kind: 'useThese' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(CHECKOUT.query)
  })

  test('"Use these" applies the draft’s queries and reads together, and closes setup', async () => {
    const { storage } = await setUpThenChange()
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, 'comparableWork')

    expect(await setup(current, { kind: 'useThese' })).toMatchObject({ kind: 'saved' })

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT, Q3_POLISH], query: BOTH })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [Q3_POLISH], query: Q3_POLISH.query })
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toMatchObject({ readAt: NEXT_READ_AT, tickets: open(7) })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })?.readAt).toBe(NEXT_READ_AT)
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(await forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
    expect(await setupAt(current)).toMatchObject({ kind: 'summary', readOn: '13 Nov 10:00' })
  })

  test('Cancel discards the draft: the Inputs view and the Milestone forecast view are as they were before setup opened', async () => {
    const { storage } = await setUpThenChange()
    const before = { inputs: await inputs(current), forecast: await forecast() }
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, 'comparableWork')

    expect(await setup(current, { kind: 'cancel' })).toMatchObject({ kind: 'saved' })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(await setupAt(current)).toMatchObject({ kind: 'summary', readOn: '12 Nov 09:05' })
    expect(await inputs(current)).toEqual(before.inputs)
    expect(await forecast()).toEqual(before.forecast)
    await setup(current, { kind: 'change' })
    expect(await stepInSetup()).toMatchObject({ query: CHECKOUT.query, picks: [CHECKOUT], read: '3 open · 4 finished in the last 9 weeks' })
  })

  test('Cancel in a first setup discards the draft and the connection made in it: the team is as it was before setup opened', async () => {
    current = await team()
    const { storage } = current
    const before = { inputs: await inputs(current), forecast: await forecast() }
    await connect(current)
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(await setup(current, { kind: 'cancel' })).toMatchObject({ kind: 'saved' })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await current.secrets.token(TEAM)).toBeUndefined()
    expect(await setupAt(current)).toMatchObject({ kind: 'steps', step: 'connect' })
    expect(await inputs(current)).toEqual(before.inputs)
    expect(await forecast()).toEqual(before.forecast)
  })

  test('a query edit in setup is read at once, and the step shows its read and flags, from the draft', async () => {
    await setUpThenChange()
    current.fixture.reads['is:open'] = { tickets: open(2), incomplete: true }

    expect(await inSetup({ kind: 'editQuery', query: BOTH })).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'milestone', editing: true } })
    expect(await stepInSetup()).toMatchObject({ query: BOTH, read: '7 open · 0 finished in the last 9 weeks' })

    await inSetup({ kind: 'editQuery', query: 'is:open' })
    expect(await stepInSetup()).toMatchObject({ query: 'is:open', flag: expect.stringContaining('gave only part') })
  })

  test('a query refused in setup leaves the draft as it was', async () => {
    const { storage } = await setUpThenChange()
    current.fixture.reads['closed:>2026-13-45'] = { failure: 'invalidQuery', message: 'Invalid date' }
    await inSetup({ kind: 'editQuery', query: BOTH })
    const draft = storage.setupDraft(TEAM)

    expect(await inSetup({ kind: 'editQuery', query: 'closed:>2026-13-45' })).toMatchObject({ kind: 'refused' })
    expect(await inSetup({ kind: 'editQuery', query: 'label:checkout payments' })).toMatchObject({ kind: 'refused' })

    expect(storage.setupDraft(TEAM)).toEqual(draft)
    expect(await stepInSetup()).toMatchObject({ query: BOTH })
  })

  /** The milestone renamed on the Inputs screen, from Checkout v2 to `choice`'s name, which the handle follows. */
  async function renameTo(choice: Choice) {
    current.at(NEXT_READ_AT)
    await submitInputs(current, { kind: 'setMilestone', name: choice.name, startDate: '2026-11-16', ticketsRemaining: '30' })
  }

  test('a skip in setup reads the draft’s queries back too, into the draft, as well as the saved ones', async () => {
    const { storage } = await setUpThenChange()
    await submitInputs(current, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-07', ticketsRemaining: '30' })
    await inSetup({ kind: 'editQuery', query: BOTH })
    current.calls.since.length = 0

    await skip(current, ['2026-11-02'], NEXT_READ_AT)

    expect(current.calls.since).toEqual(['2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z'])
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.finishedSince).toBe('2026-09-04T10:00:00.000Z')
    expect(storage.setupDraft(TEAM)?.reads.find(({ query }) => query === BOTH)?.read.finishedSince).toBe('2026-09-04T10:00:00.000Z')
  })

  test('a milestone renamed in setup follows in the draft as well as the saved query', async () => {
    const V3: Choice = { kind: 'milestone', name: 'Checkout v3', query: 'milestone:"Checkout v3"' }
    const { storage, fixture } = await setUpThenChange()
    fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, V3, Q3_POLISH], pastLimit: false }]
    fixture.reads[V3.query] = { tickets: open(4), incomplete: false }
    await inSetup({ kind: 'removePick', query: CHECKOUT.query })
    await inSetup({ kind: 'addPick', choice: CHECKOUT })

    await renameTo(V3)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [V3], query: V3.query })
    expect(storage.setupDraft(TEAM)?.milestoneQuery).toEqual({ picks: [V3], query: V3.query })
    expect(await stepInSetup()).toMatchObject({ picks: [V3], read: '4 open · 0 finished in the last 9 weeks' })
    // the draft reads the query it follows to, as the step does
    expect(storage.setupDraft(TEAM)?.reads.map(({ query }) => query)).toContain(V3.query)
  })

  test('a milestone renamed in setup follows the draft’s pick of it, where the saved query is the same written by hand', async () => {
    const V3: Choice = { kind: 'milestone', name: 'Checkout v3', query: 'milestone:"Checkout v3"' }
    const { storage, fixture } = await setUpThenChange()
    fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, V3, Q3_POLISH], pastLimit: false }]
    fixture.reads[V3.query] = { tickets: open(4), incomplete: false }
    storage.saveMilestoneQuery(TEAM, { picks: [], query: CHECKOUT.query })
    storage.saveSetupDraft(TEAM, { milestoneQuery: { picks: [CHECKOUT], query: CHECKOUT.query }, reads: [] })

    await renameTo(V3)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: CHECKOUT.query })
    expect(await stepInSetup()).toMatchObject({ picks: [V3], query: V3.query, read: '4 open · 0 finished in the last 9 weeks' })
  })

  test('a skip in setup leaves a draft read that already reaches back far enough as it was', async () => {
    const { storage } = await setUpThenChange()
    await submitInputs(current, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-07', ticketsRemaining: '30' })
    const saved = storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })
    assert(saved, 'the draft read is saved')
    const reachingFar = { ...saved, finishedSince: '2026-06-01T00:00:00.000Z' }
    storage.saveSetupDraft(TEAM, { reads: [{ query: CHECKOUT.query, read: reachingFar }] })
    current.calls.since.length = 0

    await skip(current, ['2026-11-02'], NEXT_READ_AT)

    expect(current.calls.since).toEqual(['2026-09-04T10:00:00.000Z'])
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.finishedSince).toBe('2026-09-04T10:00:00.000Z')
    expect(storage.setupDraft(TEAM)?.reads).toEqual([{ query: CHECKOUT.query, read: reachingFar }])
  })
})

// Cancel puts setup back as it was before its steps opened: the summary, connecting skipped, or a first setup's
// steps; a connection made in the steps goes with it, one there before them stays.
describe('Cancel', () => {
  const cancel = () => setup(current, { kind: 'cancel' })

  test('after Skip, then Change and Connect, removes the connection made and returns to connecting skipped', async () => {
    current = await team()
    const { storage } = current
    await setup(current, { kind: 'skipConnecting' })
    await setup(current, { kind: 'change' })
    await connect(current)

    expect(await cancel()).toMatchObject({ kind: 'saved' })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await setupAt(current)).toEqual({ kind: 'skipped' })
  })

  test('in a team connected before setup’s steps came (#217), with no milestone query, keeps its connection', async () => {
    current = await team()
    const { storage } = current
    await connect(current)
    // as migration 20 leaves such a team: setup open, with no connection made in it
    storage.saveSetupState(TEAM, { open: true })
    await pick(current, READ_AT)

    expect(await cancel()).toMatchObject({ kind: 'saved' })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(await setupAt(current)).toMatchObject({ kind: 'steps', step: 'milestone' })
  })

  test('is refused once the connection the steps opened on is changed in them, and the step says why in its place', async () => {
    current = await team()
    const { storage } = current
    await connect(current)
    await pick(current, READ_AT)
    await setup(current, { kind: 'useThese' })
    await setup(current, { kind: 'change' })
    expect(await setupAt(current)).not.toHaveProperty('noCancel')

    await connect(current, 'jira')

    expect(await setupAt(current)).toMatchObject({ kind: 'steps', noCancel: NO_CANCEL })
    await cancel()
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'jira' })
    expect(storage.setupState(TEAM)).toMatchObject({ open: true })
  })

  test('in a first setup, still removes a connection made there and then changed', async () => {
    current = await team()
    const { storage } = current
    await connect(current)
    await connect(current, 'jira')

    expect(await setupAt(current)).not.toHaveProperty('noCancel')
    expect(await cancel()).toMatchObject({ kind: 'saved' })
    expect(storage.connection(TEAM)).toBeUndefined()
  })
})
