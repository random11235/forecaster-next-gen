import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { openSetup, setupView, submitSetup, type SetupEdit } from '../../src/forecast/setup.js'
import type { SetupStep } from '../../src/forecast/setupSteps.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, open, TEAM, type TrackerScenario } from '../trackerScenario.js'
import { READ_AT, Q3_POLISH, scenario, team, settingUp } from './setupScenario.js'

// Seam B: the Inputs screen's setup steps (#217), Connect → Milestone → Comparable work → Check, one at a time, closing
// with "Use these" to a summary of the connection, or skipped to the inputs typed. The setup tests share
// setupScenario.ts; the summary's counts and flags, its reads, the draft and Check each have a file beside this one.

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
    const at = (step: SetupStep) => setupView(settingUp(scenario!), TEAM, step)

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
    const at = (step: SetupStep) => setupView(settingUp(scenario!), TEAM, step)

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
  })

  test('open, as the Inputs screen asks, at the step its URL names, or at a step whose form was just refused', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    const opened = (opening: { asked?: string; refused?: SetupStep }) => openSetup(settingUp(scenario!), TEAM, opening, READ_AT)

    expect(await opened({ asked: 'comparableWork' })).toMatchObject({ step: 'comparableWork' })
    expect(await opened({ asked: 'nonsense' })).toMatchObject({ step: 'milestone' })
    expect(await opened({ asked: 'check', refused: 'connect' })).toMatchObject({ step: 'connect' })
  })

  test('go on, after a setup edit, to Check for a source, Connect for Change from a refused token, Milestone as the steps open there, else the screen as it opens', async () => {
    const { connect, pick } = team()
    const submit = (edit: SetupEdit) => submitSetup(settingUp(scenario!), TEAM, edit)
    expect(await submit({ kind: 'change' })).not.toHaveProperty('next')
    await connect()
    await pick(READ_AT)

    expect(await submit({ kind: 'chooseSource', value: 'pace', source: 'tracker' })).toMatchObject({ next: 'check' })
    expect(await submit({ kind: 'useThese' })).not.toHaveProperty('next')
    expect(await submit({ kind: 'change', at: 'connect' })).toMatchObject({ saved: true, next: 'connect' })
    expect(await submit({ kind: 'cancel' })).not.toHaveProperty('next')
    expect(await submit({ kind: 'change' })).toMatchObject({ saved: true, next: 'milestone' })
  })

  test('are not in the browser build, which has nothing to connect with', () => {
    expect(setupView(undefined, TEAM)).toEqual({ kind: 'noSetup' })
  })
})

describe('"Use these"', () => {
  test('closes setup to a summary naming the tracker, the repo and when the milestone was read, in the EM’s time zone', async () => {
    const { connect, pick, fixture } = team()
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    await connect()
    await pick(READ_AT)

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: true })
    expect(setupView({ ...settingUp(scenario!), timeZone: 'Australia/Sydney' }, TEAM)).toEqual({
      kind: 'summary',
      tracker: 'GitHub',
      where: 'shop-team/shop',
      readOn: '12 Nov 20:05',
      milestone: { picks: [{ name: 'Checkout v2', kind: 'milestone', count: 3 }] },
      note: 'Leaf tickets only. Epics include their sub-epics.',
      flags: [],
    })
  })

  test('names a Jira project', async () => {
    const { connect, pick } = team()
    await connect('jira')
    await pick(READ_AT)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', tracker: 'Jira', where: 'shop.atlassian.net · SHOP' })
  })

  test('is refused, and setup stays open, until the team is connected and the milestone has a query', async () => {
    const { connect } = team()
    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: false })
    await connect()
    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: false })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })
  })
})

describe('the summary’s rows', () => {
  const SEARCH: Choice = { kind: 'epic', name: '#57 Search revamp', query: 'parent-issue:shop-team/shop#57' }
  const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }

  /** Connected, with the milestone picked (as `choices`, all read with `tickets`), and setup closed with "Use these". */
  async function setUp(choices: Choice[] = [CHECKOUT]): Promise<TrackerScenario> {
    const { connect, pick, fixture } = team()
    fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH, SEARCH, BUG], pastLimit: false }]
    for (const choice of [SEARCH, BUG]) fixture.reads[choice.query] = { tickets: [{ id: choice.name, finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await connect()
    for (const choice of choices) await pick(READ_AT, choice)
    return scenario!
  }
  const summary = async () => (await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' }), setupView(settingUp(scenario!), TEAM))

  test('name the milestone’s and comparable work’s picks, in the order picked, each with its kind', async () => {
    const { fixture } = await setUp([CHECKOUT, SEARCH])
    fixture.reads[Q3_POLISH.query] = { tickets: [{ id: 'q', finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await scenario!.pick(READ_AT, BUG, COMPARABLE_WORK)
    await scenario!.pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)

    expect(await summary()).toMatchObject({
      milestone: {
        picks: [
          { name: 'Checkout v2', kind: 'milestone' },
          { name: '#57 Search revamp', kind: 'epic' },
        ],
      },
      comparable: {
        picks: [
          { name: 'bug', kind: 'label' },
          { name: 'Q3 polish', kind: 'milestone' },
        ],
      },
    })
  })

  test('show a query written by hand as written, and no Comparable row without comparable work', async () => {
    const { fixture } = await setUp()
    const written = 'milestone:"Checkout v2" -label:wontfix'
    fixture.reads[written] = { tickets: open(3), incomplete: false }
    await submitStepQuery(scenario!.using, TEAM, { kind: 'editQuery', query: written }, READ_AT)

    const view = await summary()
    expect(view).toMatchObject({ milestone: { query: written } })
    expect(view).not.toHaveProperty('comparable')
  })

  test('name Jira’s picks in Jira’s kinds', async () => {
    const VERSION: Choice = { kind: 'fixVersion', name: '2.4', query: 'fixVersion = "2.4"' }
    const EPIC: Choice = { kind: 'epic', name: 'SHOP-41 Checkout v2', query: 'parent = SHOP-41' }
    const LABEL: Choice = { kind: 'label', name: 'checkout', query: 'labels = checkout' }
    const { fixture } = team()
    for (const choice of [VERSION, EPIC, LABEL]) fixture.reads[choice.query] = { tickets: open(1, choice.name), incomplete: false }
    await scenario!.connect('jira')
    for (const choice of [VERSION, EPIC, LABEL]) await scenario!.pick(READ_AT, choice)

    expect(await summary()).toMatchObject({
      milestone: {
        picks: [
          { name: '2.4', kind: 'fix version' },
          { name: 'SHOP-41 Checkout v2', kind: 'epic' },
          { name: 'checkout', kind: 'label' },
        ],
      },
    })
  })
})

describe('Change', () => {
  test('reopens the steps at Milestone, with the team’s connection and queries as they were', async () => {
    const { connect, pick, storage } = team()
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })).toMatchObject({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone', next: { step: 'comparableWork' } })
    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe('milestone:"Checkout v2"')
    expect(storage.comparableWorkQuery(TEAM)?.query).toBe('milestone:"Q3 polish"')
  })
})

describe('skipping connecting', () => {
  test('closes setup to the inputs typed, as the MVP has them, until the EM connects a tracker', async () => {
    team()

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'skipConnecting' })).toMatchObject({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toEqual({ kind: 'skipped' })
    expect(scenario!.inputs({ connected: false })).toEqual(scenario!.inputs())

    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'connect' })
  })
})
