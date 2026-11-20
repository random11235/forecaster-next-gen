import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { CHECKOUT, checkoutFixture, CONNECTIONS, forecastingForTest, type ForecastingForTest } from './forecastingForTest.js'

// The team's handle (#246): one submit for every form of the Inputs screen and the Milestone forecast screen, which owns
// what follows from it: a renamed milestone's query following it, a refused form's whole screen to show again, and a
// save in place answered with the Inputs screen.

const LOYALTY: Choice = { kind: 'milestone', name: 'Loyalty launch', query: 'milestone:"Loyalty launch"' }
const GITHUB_REPO = CONNECTIONS.github

/**
 * The team's handle on the canned connector, which lists Checkout v2 and Loyalty launch; setup closed, or open
 * (`firstSetup`); connected to GitHub when `connected`; the browser build, connecting nothing, when `browser`. The
 * handle is the team: `forecasting` and `team` are one.
 */
async function team({ firstSetup = false, connected = false, browser = false } = {}): Promise<{ forecasting: ForecastingForTest; team: ForecastingForTest }> {
  const fixture = checkoutFixture([{ id: 'c1' }, { id: 'c2' }])
  fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, LOYALTY], pastLimit: false }]
  fixture.reads[LOYALTY.query] = { tickets: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }], incomplete: false }
  const opened = await forecastingForTest({ fixture, setupOpen: firstSetup, connected, browser })
  return { forecasting: opened, team: opened }
}

/** The team's handle, connected to GitHub; setup closed, or open (`firstSetup`). */
const connectedTeam = ({ firstSetup = false } = {}) => team({ firstSetup, connected: true })

/** The milestone, as the Inputs screen's Milestone form submits it. */
const milestoneNamed = (name: string) => ({ form: 'inputs', edit: { kind: 'setMilestone', name, startDate: '2026-11-02', ticketsRemaining: '40' } }) as const

describe('renaming the milestone', () => {
  test('a save that renames the milestone moves its query, the tracker’s milestone of the old name, to the new name', async () => {
    const { forecasting, team } = await connectedTeam()
    await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'addPick', choice: CHECKOUT } })
    await forecasting.submit(milestoneNamed('Checkout v2'))

    const submitted = await forecasting.submit(milestoneNamed('Loyalty launch'))

    expect(submitted).toEqual({ kind: 'saved', next: { screen: 'inputs' } })
    expect(team.storage.milestoneQuery('team')).toEqual({ picks: [LOYALTY], query: LOYALTY.query })
  })

  test('a refused save follows nothing: the query stays on the milestone it named', async () => {
    const { forecasting, team } = await connectedTeam()
    await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'addPick', choice: CHECKOUT } })
    await forecasting.submit(milestoneNamed('Checkout v2'))

    const submitted = await forecasting.submit({
      form: 'inputs',
      edit: { kind: 'setMilestone', name: 'Loyalty launch', startDate: 'soon', ticketsRemaining: '40' },
    })

    expect(submitted.kind).toBe('refused')
    expect(team.storage.milestoneQuery('team')).toEqual({ picks: [CHECKOUT], query: CHECKOUT.query })
  })

  test('with nothing connected (the browser build), a rename is saved, with no query to follow', async () => {
    const { forecasting } = await team({ browser: true })
    await forecasting.submit(milestoneNamed('Checkout v2'))

    expect(await forecasting.submit(milestoneNamed('Loyalty launch'))).toEqual({ kind: 'saved', next: { screen: 'inputs' } })
    expect((await forecasting.inputsScreen()).inputs.milestone.name).toBe('Loyalty launch')
  })
})

describe('a refused form shows its whole screen again', () => {
  test('a refused Inputs form: the Inputs screen, the form as typed with why, beside the Connect step and setup’s summary', async () => {
    const { forecasting } = await connectedTeam()

    const submitted = await forecasting.submit({ form: 'inputs', edit: { kind: 'setCadence', cadenceDays: '0' } })

    expect(submitted).toMatchObject({
      kind: 'refused',
      view: {
        inputs: { refusal: { form: 'cadence' }, forms: { cadence: { cadenceDays: '0' } } },
        connection: { kind: 'connected' },
        setup: { kind: 'summary' },
      },
    })
  })

  test('a refused capacity form: the Milestone forecast screen', async () => {
    const { forecasting } = await connectedTeam()

    const submitted = await forecasting.submit(
      { form: 'inputs', edit: { kind: 'addCapacity', percent: 'lots', from: '2026-11-16', to: '', onward: false, note: '' } },
      { capacityOpen: true },
    )

    expect(submitted).toMatchObject({ kind: 'refusedOnForecast', view: { kind: 'empty' } })
  })

  test('a refused connect: the Inputs screen at the Connect step, as typed but for the token, saying why', async () => {
    const { forecasting } = await team({ firstSetup: true })

    const submitted = await forecasting.submit({ form: 'connection', edit: { ...GITHUB_REPO, repo: 'shop' } })

    expect(submitted).toMatchObject({
      kind: 'refused',
      view: {
        connection: { kind: 'connect', form: { repo: 'shop' }, refusal: 'Give the repo as owner/repo, like shop-team/shop.' },
        setup: { kind: 'steps', step: 'connect' },
      },
    })
    expect(submitted.kind === 'refused' && submitted.view).not.toHaveProperty('step')
  })

  test('a refused hand-edited query: the Inputs screen at its step, open for editing with the query as typed and why', async () => {
    const { forecasting } = await connectedTeam({ firstSetup: true })

    const submitted = await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'editQuery', query: 'label:' } })

    expect(submitted).toMatchObject({
      kind: 'refused',
      view: {
        setup: { kind: 'steps', step: 'milestone' },
        step: { kind: 'milestoneStep', editing: { typed: 'label:', refusal: 'label: names nothing. Give it one, such as label:"checkout".' } },
      },
    })
  })

  test('a refused comparable-work query opens the Comparable work step on its refusal, though the URL asked for none', async () => {
    const { forecasting } = await connectedTeam({ firstSetup: true })
    await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'addPick', choice: CHECKOUT } })

    const submitted = await forecasting.submit({ form: 'stepQuery', step: 'comparableWork', edit: { kind: 'editQuery', query: 'label:' } })

    expect(submitted).toMatchObject({ view: { setup: { step: 'comparableWork' }, step: { kind: 'comparableWorkStep', editing: { typed: 'label:' } } } })
  })
})

describe('a save in place', () => {
  test('is answered with the Inputs screen as saved, its query step asking the tracker nothing', async () => {
    const { forecasting, team } = await connectedTeam({ firstSetup: true })
    await forecasting.submit(milestoneNamed('Checkout v2'))
    team.calls.since.length = 0

    const submitted = await forecasting.submit({ form: 'inputs', edit: { kind: 'setAmbiguity', level: 'high' } }, { inPlace: true })

    expect(submitted).toMatchObject({
      kind: 'savedInPlace',
      view: { inputs: { milestone: { ambiguity: 'high' } }, setup: { kind: 'steps', step: 'milestone' }, step: { kind: 'milestoneStep', lists: [] } },
    })
    expect(team.calls.since).toEqual([])
  })

  test('refused, the Inputs screen again, as typed with why, its query step still asking nothing', async () => {
    const { forecasting } = await connectedTeam({ firstSetup: true })

    const submitted = await forecasting.submit({ form: 'inputs', edit: { kind: 'setCadence', cadenceDays: '0' } }, { inPlace: true })

    expect(submitted).toMatchObject({ kind: 'refused', view: { inputs: { refusal: { form: 'cadence' } }, step: { lists: [] } } })
  })

  test('without it, a save says only where to go next', async () => {
    const { forecasting } = await connectedTeam()
    await forecasting.submit(milestoneNamed('Checkout v2'))

    expect(await forecasting.submit({ form: 'inputs', edit: { kind: 'setAmbiguity', level: 'high' } })).toEqual({ kind: 'saved', next: { screen: 'forecast' } })
  })
})

describe('where a submit goes next', () => {
  test('a connect, to the Milestone step; a pick, back to its step; Read again, to the Inputs screen', async () => {
    const { forecasting } = await team({ firstSetup: true })

    expect(await forecasting.submit({ form: 'connection', edit: GITHUB_REPO })).toEqual({ kind: 'saved', next: { screen: 'inputs', step: 'milestone' } })
    expect(await forecasting.submit({ form: 'stepQuery', step: 'comparableWork', edit: { kind: 'addPick', choice: LOYALTY } })).toEqual({
      kind: 'saved',
      next: { screen: 'inputs', step: 'comparableWork' },
    })
    expect(await forecasting.submit({ form: 'readAgain' })).toEqual({ kind: 'saved', next: { screen: 'inputs' } })
  })

  test('"Use these", refused before the milestone has a query, to the step setup goes on to', async () => {
    const { forecasting } = await connectedTeam({ firstSetup: true })

    expect(await forecasting.submit({ form: 'setup', edit: { kind: 'useThese' } })).toMatchObject({ kind: 'saved', next: { screen: 'inputs' } })
  })

  test('going back to finding from a query it clears asks the EM to confirm that first, changing nothing', async () => {
    const { forecasting, team } = await connectedTeam()
    team.fixture.reads['label:checkout -label:bug'] = { tickets: [], incomplete: false }
    await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'editQuery', query: 'label:checkout -label:bug' } })

    expect(await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'backToFinding', confirmed: false } })).toEqual({
      kind: 'confirmClear',
    })
    expect(team.storage.milestoneQuery('team')).toEqual({ picks: [], query: 'label:checkout -label:bug' })
  })
})

describe('the Inputs screen, whole', () => {
  test('builds only the query step the URL asks for, open for editing, its lists narrowed to what was found', async () => {
    const { forecasting } = await connectedTeam({ firstSetup: true })
    await forecasting.submit({ form: 'stepQuery', step: 'milestone', edit: { kind: 'addPick', choice: CHECKOUT } })

    const finding = await forecasting.inputsScreen({ step: 'comparableWork', find: { milestone: 'zzz', comparableWork: 'loyal' } })
    const editing = await forecasting.inputsScreen({ step: 'comparableWork', editing: 'comparableWork' })

    expect(finding).toMatchObject({ setup: { step: 'comparableWork' }, step: { kind: 'comparableWorkStep', lists: [{ choices: [LOYALTY] }] } })
    expect(editing.step?.editing).toBeDefined()
  })

  test('opened for editing another step’s query, the step shown stays finding', async () => {
    const { forecasting } = await connectedTeam({ firstSetup: true })

    const screen = await forecasting.inputsScreen({ editing: 'comparableWork', confirmingBack: true })

    expect(screen.step).toMatchObject({ kind: 'milestoneStep' })
    expect(screen.step?.editing).toBeUndefined()
  })

  test('once setup is closed, it has its summary and no query step', async () => {
    const { forecasting } = await connectedTeam()

    const screen = await forecasting.inputsScreen({ step: 'milestone' })

    expect(screen.setup).toMatchObject({ kind: 'summary' })
    expect(screen).not.toHaveProperty('step')
  })

  test('the browser build’s has the inputs alone: no Connect step, setup or query step', async () => {
    const { forecasting: browser } = await team({ browser: true })

    const screen = await browser.inputsScreen({ step: 'milestone' })

    expect(Object.keys(screen)).toEqual(['inputs'])
  })
})
