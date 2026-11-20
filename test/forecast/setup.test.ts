import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import type { SetupEdit, SetupStep } from '../../src/forecast/index.js'
import { open } from '../trackerScenario.js'
import { CHECKOUT, forecastingForTest, pick, TEAM } from './forecastingForTest.js'
import { READ_AT, Q3_POLISH, connect, inputs, setup, setupAt, stepQuery, summary, team } from './setupScenario.js'

// Seam B: the Inputs screen's setup steps (#217), Connect → Milestone → Comparable work → Check, one at a time, closing
// with "Use these" to a summary of the connection, or skipped to the inputs typed. The setup tests share
// setupScenario.ts; the summary's counts and flags, its reads, the draft and Check each have a file beside this one.

describe('the setup steps', () => {
  test('open at Connect, the first of four, with nothing to go back or on to, until the team connects', async () => {
    const view = await setupAt(await team(), 'check')

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
    const forecasting = await team()
    await connect(forecasting)
    const before = await setupAt(forecasting)
    await pick(forecasting, READ_AT)

    expect(before).toMatchObject({ step: 'milestone', back: 'connect' })
    expect(before).not.toHaveProperty('next')
    expect(await setupAt(forecasting)).toMatchObject({
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
    const forecasting = await team()
    await connect(forecasting)
    await pick(forecasting, READ_AT)
    const at = (step: SetupStep) => setupAt(forecasting, step)

    expect(await at('connect')).toMatchObject({ step: 'connect', next: { step: 'milestone', label: 'next' } })
    expect(await at('connect')).not.toHaveProperty('back')
    expect(await at('comparableWork')).toMatchObject({ step: 'comparableWork', back: 'milestone', next: { step: 'check', label: 'skip' } })
    expect(await at('check')).toMatchObject({
      step: 'check',
      steps: [
        { step: 'connect', mark: 'done' },
        { step: 'milestone', mark: 'done' },
        { step: 'comparableWork', mark: 'done' },
        { step: 'check', mark: 'current' },
      ],
      back: 'comparableWork',
    })
    expect(await at('check')).not.toHaveProperty('next')

    await pick(forecasting, READ_AT, Q3_POLISH, 'comparableWork')
    expect(await at('comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
  })

  test('read Skip again once comparable work is started afresh, and stay at Milestone once its last pick is removed', async () => {
    const forecasting = await team()
    await connect(forecasting)
    await pick(forecasting, READ_AT)
    await pick(forecasting, READ_AT, Q3_POLISH, 'comparableWork')
    const at = (step: SetupStep) => setupAt(forecasting, step)

    await stepQuery(forecasting, { kind: 'startAfresh' }, 'comparableWork')
    expect(await at('comparableWork')).toMatchObject({ next: { step: 'check', label: 'skip' } })

    await stepQuery(forecasting, { kind: 'removePick', query: CHECKOUT.query })
    expect(await at('check')).toMatchObject({ step: 'milestone' })
    expect(await at('milestone')).not.toHaveProperty('next')
  })

  test('stay at Milestone, asked for a later step, until the milestone has a query', async () => {
    const forecasting = await team()
    await connect(forecasting)

    expect(await setupAt(forecasting, 'check')).toMatchObject({ step: 'milestone' })
    expect(await setupAt(forecasting, 'comparableWork')).toMatchObject({ step: 'milestone' })
  })

  test('open, as the Inputs screen asks, at the step its URL names, or at a step whose form was just refused', async () => {
    const forecasting = await team()
    await connect(forecasting)
    await pick(forecasting, READ_AT)

    expect(await setupAt(forecasting, 'comparableWork')).toMatchObject({ step: 'comparableWork' })
    expect(await setupAt(forecasting, 'nonsense')).toMatchObject({ step: 'milestone' })
    const refused = await forecasting.submit(
      { form: 'connection', edit: { kind: 'connect', tracker: 'github', repo: '', site: '', projectKey: '', email: '', token: '' } },
      { step: 'check' },
    )
    expect(refused).toMatchObject({ saved: false, view: { setup: { step: 'connect' } } })
  })

  test('go on, after a setup edit, to Check for a source, Connect for Change from a refused token, Milestone as the steps open there, else the screen as it opens', async () => {
    const forecasting = await team()
    const submit = (edit: SetupEdit) => setup(forecasting, edit)
    expect(await submit({ kind: 'change' })).toEqual({ saved: true, next: { screen: 'inputs' } })
    await connect(forecasting)
    await pick(forecasting, READ_AT)

    expect(await submit({ kind: 'chooseSource', value: 'pace', source: 'tracker' })).toEqual({ saved: true, next: { screen: 'inputs', step: 'check' } })
    expect(await submit({ kind: 'useThese' })).toEqual({ saved: true, next: { screen: 'inputs' } })
    expect(await submit({ kind: 'change', at: 'connect' })).toEqual({ saved: true, next: { screen: 'inputs', step: 'connect' } })
    expect(await submit({ kind: 'cancel' })).toEqual({ saved: true, next: { screen: 'inputs' } })
    expect(await submit({ kind: 'change' })).toEqual({ saved: true, next: { screen: 'inputs', step: 'milestone' } })
  })

  test('are not in the browser build, which has nothing to connect with', async () => {
    expect(await (await forecastingForTest({ browser: true, setupOpen: true })).inputsScreen()).not.toHaveProperty('setup')
  })
})

describe('"Use these"', () => {
  test('closes setup to a summary naming the tracker, the repo and when the milestone was read, in the EM’s time zone', async () => {
    const forecasting = await team({ timeZone: 'Australia/Sydney' })
    forecasting.fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    await connect(forecasting)
    await pick(forecasting, READ_AT)

    expect(await summary(forecasting)).toEqual({
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
    const forecasting = await team()
    await connect(forecasting, 'jira')
    await pick(forecasting, READ_AT)

    expect(await summary(forecasting)).toMatchObject({ kind: 'summary', tracker: 'Jira', where: 'shop.atlassian.net · SHOP' })
  })

  test('is refused, and setup stays open, until the team is connected and the milestone has a query', async () => {
    const forecasting = await team()
    expect(await summary(forecasting)).toMatchObject({ kind: 'steps', step: 'connect' })
    await connect(forecasting)
    expect(await summary(forecasting)).toMatchObject({ kind: 'steps', step: 'milestone' })

    expect(forecasting.storage.setupState(TEAM)).toMatchObject({ open: true })
  })
})

describe('the summary’s rows', () => {
  const SEARCH: Choice = { kind: 'epic', name: '#57 Search revamp', query: 'parent-issue:shop-team/shop#57' }
  const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }

  /** Connected, with the milestone picked (as `choices`, all read with `tickets`). */
  async function setUp(choices: Choice[] = [CHECKOUT]) {
    const forecasting = await team()
    const { fixture } = forecasting
    fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH, SEARCH, BUG], pastLimit: false }]
    for (const choice of [SEARCH, BUG]) fixture.reads[choice.query] = { tickets: [{ id: choice.name, finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await connect(forecasting)
    for (const choice of choices) await pick(forecasting, READ_AT, choice)
    return forecasting
  }

  test('name the milestone’s and comparable work’s picks, in the order picked, each with its kind', async () => {
    const forecasting = await setUp([CHECKOUT, SEARCH])
    forecasting.fixture.reads[Q3_POLISH.query] = { tickets: [{ id: 'q', finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await pick(forecasting, READ_AT, BUG, 'comparableWork')
    await pick(forecasting, READ_AT, Q3_POLISH, 'comparableWork')

    expect(await summary(forecasting)).toMatchObject({
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
    const forecasting = await setUp()
    const written = 'milestone:"Checkout v2" -label:wontfix'
    forecasting.fixture.reads[written] = { tickets: open(3), incomplete: false }
    await stepQuery(forecasting, { kind: 'editQuery', query: written })

    const view = await summary(forecasting)
    expect(view).toMatchObject({ milestone: { query: written } })
    expect(view).not.toHaveProperty('comparable')
  })

  test('name Jira’s picks in Jira’s kinds', async () => {
    const VERSION: Choice = { kind: 'fixVersion', name: '2.4', query: 'fixVersion = "2.4"' }
    const EPIC: Choice = { kind: 'epic', name: 'SHOP-41 Checkout v2', query: 'parent = SHOP-41' }
    const LABEL: Choice = { kind: 'label', name: 'checkout', query: 'labels = checkout' }
    const forecasting = await team()
    for (const choice of [VERSION, EPIC, LABEL]) forecasting.fixture.reads[choice.query] = { tickets: open(1, choice.name), incomplete: false }
    await connect(forecasting, 'jira')
    for (const choice of [VERSION, EPIC, LABEL]) await pick(forecasting, READ_AT, choice)

    expect(await summary(forecasting)).toMatchObject({
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
    const forecasting = await team()
    const { storage } = forecasting
    await connect(forecasting)
    await pick(forecasting, READ_AT)
    await pick(forecasting, READ_AT, Q3_POLISH, 'comparableWork')
    await setup(forecasting, { kind: 'useThese' })

    expect(await setup(forecasting, { kind: 'change' })).toMatchObject({ saved: true })
    expect(await setupAt(forecasting)).toMatchObject({ kind: 'steps', step: 'milestone', next: { step: 'comparableWork' } })
    expect(await setupAt(forecasting, 'comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe('milestone:"Checkout v2"')
    expect(storage.comparableWorkQuery(TEAM)?.query).toBe('milestone:"Q3 polish"')
  })
})

describe('skipping connecting', () => {
  test('closes setup to the inputs typed, as the MVP has them, until the EM connects a tracker', async () => {
    const forecasting = await team()

    expect(await setup(forecasting, { kind: 'skipConnecting' })).toMatchObject({ saved: true })
    expect(await setupAt(forecasting)).toEqual({ kind: 'skipped' })
    expect((await forecasting.browserBuild().inputsScreen()).inputs).toEqual(await inputs(forecasting))

    await setup(forecasting, { kind: 'change' })
    expect(await setupAt(forecasting)).toMatchObject({ kind: 'steps', step: 'connect' })
  })
})
