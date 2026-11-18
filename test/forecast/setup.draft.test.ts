import { assert, describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { followRenamedMilestone } from '../../src/forecast/milestoneRenamed.js'
import { NO_CANCEL, setupView, submitSetup } from '../../src/forecast/setup.js'
import { queryStepView, submitStepQuery, type StepQueryEdit } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, finishedOn, open, TEAM, TODAY, type TrackerScenario } from '../trackerScenario.js'
import { READ_AT, Q3_POLISH, scenario, team, settingUp } from './setupScenario.js'

// What the EM chooses inside setup (#218) is held as a draft: nothing in it reaches the forecast or the Inputs values
// until "Use these" applies it all together, and Cancel throws it away.
describe('the draft', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`

  /** A team set up on GitHub, following its milestone's 3 open tickets, then setup opened again with Change. */
  async function setUpThenChange(): Promise<TrackerScenario> {
    const { connect, submit } = team()
    scenario().fixture.reads[CHECKOUT.query] = {
      tickets: [...open(3), ...finishedOn('f', '2026-11-03', 2), ...finishedOn('g', '2026-10-27', 2)],
      incomplete: false,
    }
    scenario().fixture.reads[BOTH] = { tickets: open(7), incomplete: false }
    scenario().fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete: false }
    await connect()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    return scenario()
  }

  /** A query step's submit made inside setup, through the draft. */
  const inSetup = (edit: StepQueryEdit, readAt = NEXT_READ_AT, stepQuery: StepQuery = MILESTONE_QUERY) =>
    submitStepQuery(scenario().using, TEAM, edit, readAt, stepQuery)

  /** A query step as setup shows it, through the draft. */
  const stepInSetup = (stepQuery: StepQuery = MILESTONE_QUERY) =>
    queryStepView({ ...scenario().using, at: { readAt: NEXT_READ_AT, today: TODAY, timeZone: 'UTC' } }, TEAM, '', { unlisted: true }, stepQuery)

  test('picks and a hand-written query made in setup leave the saved queries, saved reads and the forecast unchanged until "Use these"', async () => {
    const { storage, inputs, forecast } = await setUpThenChange()
    const before = { inputs: inputs(), forecast: forecast() }
    expect(before.forecast).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })

    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT], query: CHECKOUT.query })
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.readAt).toBe(READ_AT)
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
  })

  test('a first setup’s picks reach nothing either, until "Use these"', async () => {
    const { connect, storage, inputs } = team()
    await connect()
    const before = inputs()

    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
    expect(inputs()).toEqual(before)
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ step: 'milestone', next: { step: 'comparableWork' } })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(CHECKOUT.query)
  })

  test('"Use these" applies the draft’s queries and reads together, and closes setup', async () => {
    const { storage, forecast } = await setUpThenChange()
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })).toMatchObject({ saved: true })

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT, Q3_POLISH], query: BOTH })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [Q3_POLISH], query: Q3_POLISH.query })
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toMatchObject({ readAt: NEXT_READ_AT, tickets: open(7) })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })?.readAt).toBe(NEXT_READ_AT)
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ kind: 'summary', readOn: '13 Nov 10:00' })
  })

  test('Cancel discards the draft: the Inputs view and the Milestone forecast view are as they were before setup opened', async () => {
    const { storage, inputs, forecast } = await setUpThenChange()
    const before = { inputs: inputs(), forecast: forecast() }
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(await submitSetup(settingUp(scenario()), TEAM, { kind: 'cancel' })).toMatchObject({ saved: true })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ kind: 'summary', readOn: '12 Nov 09:05' })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    expect(await stepInSetup()).toMatchObject({ query: CHECKOUT.query, picks: [CHECKOUT], read: '3 open · 4 finished in the last 9 weeks' })
  })

  test('Cancel in a first setup discards the draft and the connection made in it: the team is as it was before setup opened', async () => {
    const { connect, storage, using, inputs, forecast } = team()
    const before = { inputs: inputs(), forecast: forecast() }
    await connect()
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(await submitSetup(settingUp(scenario()), TEAM, { kind: 'cancel' })).toMatchObject({ saved: true })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ kind: 'steps', step: 'connect' })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
  })

  test('a query edit in setup is read at once, and the step shows its read and flags, from the draft', async () => {
    await setUpThenChange()
    scenario().fixture.reads['is:open'] = { tickets: open(2), incomplete: true }

    expect(await inSetup({ kind: 'editQuery', query: BOTH })).toMatchObject({ kind: 'saved', read: { ok: true } })
    expect(await stepInSetup()).toMatchObject({ query: BOTH, read: '7 open · 0 finished in the last 9 weeks' })

    await inSetup({ kind: 'editQuery', query: 'is:open' })
    expect(await stepInSetup()).toMatchObject({ query: 'is:open', flag: expect.stringContaining('gave only part') })
  })

  test('a query refused in setup leaves the draft as it was', async () => {
    const { storage } = await setUpThenChange()
    scenario().fixture.reads['closed:>2026-13-45'] = { failure: 'invalidQuery', message: 'Invalid date' }
    await inSetup({ kind: 'editQuery', query: BOTH })
    const draft = storage.setupDraft(TEAM)

    expect(await inSetup({ kind: 'editQuery', query: 'closed:>2026-13-45' })).toMatchObject({ kind: 'refused' })
    expect(await inSetup({ kind: 'editQuery', query: 'label:checkout payments' })).toMatchObject({ kind: 'refused' })

    expect(storage.setupDraft(TEAM)).toEqual(draft)
    expect(await stepInSetup()).toMatchObject({ query: BOTH })
  })

  test('a skip in setup reads the draft’s queries back too, into the draft, as well as the saved ones', async () => {
    const { storage, submit } = await setUpThenChange()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-07', ticketsRemaining: '30' })
    await inSetup({ kind: 'editQuery', query: BOTH })
    scenario().asked.length = 0

    await scenario().skip(['2026-11-02'], NEXT_READ_AT)

    expect(scenario().asked).toEqual(['2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z'])
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

    await followRenamedMilestone(scenario().using, TEAM, { from: CHECKOUT.name, to: V3.name }, NEXT_READ_AT)

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

    await followRenamedMilestone(scenario().using, TEAM, { from: CHECKOUT.name, to: V3.name }, NEXT_READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [], query: CHECKOUT.query })
    expect(await stepInSetup()).toMatchObject({ picks: [V3], query: V3.query, read: '4 open · 0 finished in the last 9 weeks' })
  })

  test('a skip in setup leaves a draft read that already reaches back far enough as it was', async () => {
    const { storage, submit } = await setUpThenChange()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-07', ticketsRemaining: '30' })
    const saved = storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })
    assert(saved, 'the draft read is saved')
    const reachingFar = { ...saved, finishedSince: '2026-06-01T00:00:00.000Z' }
    storage.saveSetupDraft(TEAM, { reads: [{ query: CHECKOUT.query, read: reachingFar }] })
    scenario().asked.length = 0

    await scenario().skip(['2026-11-02'], NEXT_READ_AT)

    expect(scenario().asked).toEqual(['2026-09-04T10:00:00.000Z'])
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.finishedSince).toBe('2026-09-04T10:00:00.000Z')
    expect(storage.setupDraft(TEAM)?.reads).toEqual([{ query: CHECKOUT.query, read: reachingFar }])
  })
})

// Cancel puts setup back as it was before its steps opened: the summary, connecting skipped, or a first setup's
// steps; a connection made in the steps goes with it, one there before them stays.
describe('Cancel', () => {
  const cancel = () => submitSetup(settingUp(scenario()), TEAM, { kind: 'cancel' })

  test('after Skip, then Change and Connect, removes the connection made and returns to connecting skipped', async () => {
    const { connect, storage } = team()
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'skipConnecting' })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    await connect()

    expect(await cancel()).toMatchObject({ saved: true })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario()), TEAM)).toEqual({ kind: 'skipped' })
  })

  test('in a team connected before setup’s steps came (#217), with no milestone query, keeps its connection', async () => {
    const { connect, storage } = team()
    await connect()
    // as migration 20 leaves such a team: setup open, with no connection made in it
    storage.saveSetupState(TEAM, { open: true })
    await scenario().pick(READ_AT)

    expect(await cancel()).toMatchObject({ saved: true })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })
  })

  test('is refused once the connection the steps opened on is changed in them, and the step says why in its place', async () => {
    const { connect, pick, storage } = team()
    await connect()
    await pick(READ_AT)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario()), TEAM)).not.toHaveProperty('noCancel')

    await connect('jira')

    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ kind: 'steps', noCancel: NO_CANCEL })
    expect(await cancel()).toMatchObject({ saved: false })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'jira' })
    expect(storage.setupState(TEAM)).toMatchObject({ open: true })
  })

  test('in a first setup, still removes a connection made there and then changed', async () => {
    const { connect, storage } = team()
    await connect()
    await connect('jira')

    expect(setupView(settingUp(scenario()), TEAM)).not.toHaveProperty('noCancel')
    expect(await cancel()).toMatchObject({ saved: true })
    expect(storage.connection(TEAM)).toBeUndefined()
  })
})
