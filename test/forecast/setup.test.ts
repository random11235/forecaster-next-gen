import { afterEach, describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { setupView, submitSetup, throughDraft, type SettingUp } from '../../src/forecast/setup.js'
import { queryStepView, submitStepQuery, type StepQueryEdit } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, finishedOn, open, TEAM, TODAY, trackerScenario, type TrackerScenario } from '../trackerScenario.js'

// Seam B: the Inputs screen's setup steps (#217), Connect → Milestone → Comparable work → Check, one at a time, closing
// with "Use these" to a summary of the connection, or skipped to the inputs typed.

const READ_AT = '2026-11-12T09:05:00Z'
const Q3_POLISH: Choice = { kind: 'milestone', name: 'Q3 polish', query: 'milestone:"Q3 polish"' }

let scenario: TrackerScenario | undefined

afterEach(() => {
  scenario?.close()
  scenario = undefined
})

/** A team not yet connected, with Q3 polish to pick as comparable work. */
function team(): TrackerScenario {
  scenario = trackerScenario()
  scenario.fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH], pastLimit: false }]
  scenario.fixture.reads[Q3_POLISH.query] = { tickets: [], incomplete: false }
  return scenario
}

const settingUp = ({ using }: TrackerScenario): SettingUp => ({ ...using, timeZone: 'UTC' })

describe('the setup steps', () => {
  test('open at Connect, the first of four, with nothing to go back or on to, until the team connects', () => {
    const view = setupView(settingUp(team()), TEAM, 'check')

    expect(view).toEqual({
      kind: 'steps',
      step: 'connect',
      steps: [
        { step: 'connect', mark: 'current' },
        { step: 'milestone', mark: 'ahead' },
        { step: 'comparableWork', mark: 'ahead' },
        { step: 'check', mark: 'ahead' },
      ],
    })
  })

  test('once connected, open at Milestone, back to Connect, and on to Comparable work only once the milestone has a query', async () => {
    const { connect, pick } = team()
    await connect()
    const before = setupView(settingUp(scenario!), TEAM)
    await pick(READ_AT)

    expect(before).toMatchObject({ step: 'milestone', back: 'connect' })
    expect(before).not.toHaveProperty('next')
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({
      step: 'milestone',
      steps: [
        { step: 'connect', mark: 'done' },
        { step: 'milestone', mark: 'current' },
        { step: 'comparableWork', mark: 'ahead' },
        { step: 'check', mark: 'ahead' },
      ],
      back: 'connect',
      next: { step: 'comparableWork', label: 'next' },
    })
  })

  test('walk forward to Check and back, Comparable work skipped until it has a query, then Next', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    const at = (step: string) => setupView(settingUp(scenario!), TEAM, step)

    expect(at('connect')).toMatchObject({ step: 'connect', next: { step: 'milestone', label: 'next' } })
    expect(at('connect')).not.toHaveProperty('back')
    expect(at('comparableWork')).toMatchObject({ step: 'comparableWork', back: 'milestone', next: { step: 'check', label: 'skip' } })
    expect(at('check')).toMatchObject({
      step: 'check',
      steps: [
        { step: 'connect', mark: 'done' },
        { step: 'milestone', mark: 'done' },
        { step: 'comparableWork', mark: 'done' },
        { step: 'check', mark: 'current' },
      ],
      back: 'comparableWork',
    })
    expect(at('check')).not.toHaveProperty('next')

    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    expect(at('comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
  })

  test('read Skip again once comparable work is started afresh, and stay at Milestone once its last pick is removed', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    const at = (step: string) => setupView(settingUp(scenario!), TEAM, step)

    await submitStepQuery(scenario!.using, TEAM, { kind: 'startAfresh' }, READ_AT, COMPARABLE_WORK)
    expect(at('comparableWork')).toMatchObject({ next: { step: 'check', label: 'skip' } })

    await submitStepQuery(scenario!.using, TEAM, { kind: 'removePick', query: CHECKOUT.query }, READ_AT)
    expect(at('check')).toMatchObject({ step: 'milestone' })
    expect(at('milestone')).not.toHaveProperty('next')
  })

  test('stay at Milestone, asked for a later step, until the milestone has a query', async () => {
    const { connect } = team()
    await connect()

    expect(setupView(settingUp(scenario!), TEAM, 'check')).toMatchObject({ step: 'milestone' })
    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).toMatchObject({ step: 'milestone' })
    expect(setupView(settingUp(scenario!), TEAM, 'nonsense')).toMatchObject({ step: 'milestone' })
  })

  test('are not in the browser build, which has nothing to connect with', () => {
    expect(setupView(undefined, TEAM)).toEqual({ kind: 'noSetup' })
  })
})

describe('"Use these"', () => {
  test('closes setup to a summary naming the tracker, the repo and when the milestone was read, in the EM’s time zone', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: true })
    expect(setupView({ ...settingUp(scenario!), timeZone: 'Australia/Sydney' }, TEAM)).toEqual({
      kind: 'summary',
      tracker: 'GitHub',
      where: 'shop-team/shop',
      readOn: '12 Nov 20:05',
    })
  })

  test('names a Jira project', async () => {
    const { connect, pick } = team()
    await connect('jira')
    await pick(READ_AT)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', tracker: 'Jira', where: 'shop.atlassian.net · SHOP' })
  })

  test('is refused, and setup stays open, until the team is connected and the milestone has a query', async () => {
    const { connect } = team()
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: false })
    await connect()
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: false })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })
  })
})

describe('Change', () => {
  test('reopens the steps at Milestone, with the team’s connection and queries as they were', async () => {
    const { connect, pick, storage } = team()
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })).toEqual({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone', next: { step: 'comparableWork' } })
    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe('milestone:"Checkout v2"')
    expect(storage.comparableWorkQuery(TEAM)?.query).toBe('milestone:"Q3 polish"')
  })
})

describe('skipping connecting', () => {
  test('closes setup to the inputs typed, as the MVP has them, until the EM connects a tracker', () => {
    team()

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'skipConnecting' })).toEqual({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toEqual({ kind: 'skipped' })
    expect(scenario!.inputs({ connected: false })).toEqual(scenario!.inputs())

    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'connect' })
  })
})

// What the EM chooses inside setup (#218) is held as a draft: nothing in it reaches the forecast or the Inputs values
// until "Use these" applies it all together, and Cancel throws it away.
describe('the draft', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`

  /** A team set up on GitHub, following its milestone's 3 open tickets, then setup opened again with Change. */
  async function setUpThenChange(): Promise<TrackerScenario> {
    const { connect, submit } = team()
    scenario!.fixture.reads[CHECKOUT.query] = { tickets: [...open(3), ...finishedOn('f', '2026-11-03', 2), ...finishedOn('g', '2026-10-27', 2)], incomplete: false }
    scenario!.fixture.reads[BOTH] = { tickets: open(7), incomplete: false }
    scenario!.fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete: false }
    await connect()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    return scenario!
  }

  /** A query step's submit made inside setup, through the draft. */
  const inSetup = (edit: StepQueryEdit, readAt = NEXT_READ_AT, stepQuery: StepQuery = MILESTONE_QUERY) =>
    submitStepQuery(throughDraft(scenario!.using), TEAM, edit, readAt, stepQuery)

  /** A query step as setup shows it, through the draft. */
  const stepInSetup = (stepQuery: StepQuery = MILESTONE_QUERY) =>
    queryStepView({ ...throughDraft(scenario!.using), at: { readAt: NEXT_READ_AT, today: TODAY, timeZone: 'UTC' } }, TEAM, '', { unlisted: true }, stepQuery)

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
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ step: 'milestone', next: { step: 'comparableWork' } })
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(CHECKOUT.query)
  })

  test('"Use these" applies the draft’s queries and reads together, and closes setup', async () => {
    const { storage, forecast } = await setUpThenChange()
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: true })

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT, Q3_POLISH], query: BOTH })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [Q3_POLISH], query: Q3_POLISH.query })
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toMatchObject({ readAt: NEXT_READ_AT, tickets: open(7) })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })?.readAt).toBe(NEXT_READ_AT)
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', readOn: '13 Nov 10:00' })
  })

  test('Cancel discards the draft: the Inputs view and the Milestone forecast view are as they were before setup opened', async () => {
    const { storage, inputs, forecast } = await setUpThenChange()
    const before = { inputs: inputs(), forecast: forecast() }
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })).toEqual({ saved: true })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', readOn: '12 Nov 09:05' })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(await stepInSetup()).toMatchObject({ query: CHECKOUT.query, picks: [CHECKOUT], read: '3 open · 4 finished in the last 9 weeks' })
  })

  test('Cancel is offered once setup opens again from its summary, and not in a first setup, where it is refused', async () => {
    const { connect } = team()
    await connect()
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(setupView(settingUp(scenario!), TEAM)).not.toHaveProperty('cancel')
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })).toEqual({ saved: false })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })

    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone', cancel: true })
    expect(setupView(settingUp(scenario!), TEAM, 'check')).toMatchObject({ step: 'check', cancel: true })
  })

  test('a query edit in setup is read at once, and the step shows its read and flags, from the draft', async () => {
    await setUpThenChange()
    scenario!.fixture.reads['is:open'] = { tickets: open(2), incomplete: true }

    expect(await inSetup({ kind: 'editQuery', query: BOTH })).toMatchObject({ kind: 'saved', read: { ok: true } })
    expect(await stepInSetup()).toMatchObject({ query: BOTH, read: '7 open · 0 finished in the last 9 weeks' })

    await inSetup({ kind: 'editQuery', query: 'is:open' })
    expect(await stepInSetup()).toMatchObject({ query: 'is:open', flag: expect.stringContaining('gave only part') })
  })

  test('a query refused in setup leaves the draft as it was', async () => {
    const { storage } = await setUpThenChange()
    scenario!.fixture.reads['closed:>2026-13-45'] = { failure: 'invalidQuery', message: 'Invalid date' }
    await inSetup({ kind: 'editQuery', query: BOTH })
    const draft = storage.setupDraft(TEAM)

    expect(await inSetup({ kind: 'editQuery', query: 'closed:>2026-13-45' })).toMatchObject({ kind: 'refused' })
    expect(await inSetup({ kind: 'editQuery', query: 'label:checkout payments' })).toMatchObject({ kind: 'refused' })

    expect(storage.setupDraft(TEAM)).toEqual(draft)
    expect(await stepInSetup()).toMatchObject({ query: BOTH })
  })
})
