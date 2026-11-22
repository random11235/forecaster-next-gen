import type { Forecasting } from '../../../src/forecast/index.js'
import { beforeEach, describe, expect, test } from 'vitest'
import { checkoutFixture, forecastingForTest, pick, submitInputs } from '../../forecast/forecastingForTest.js'
import { label } from '../../trackerScenario.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, one, text } from '../dom.js'
import { READ_AT, refused, screen, section, START, TICKETS } from './inputsScreenHarness.js'

// The Inputs screen (#236), rendered from the views Seam B gives (see inputsScreenHarness.ts): empty, refused, warned,
// and each setup step and its summary; inputsScreen.sources.test.ts has each source of tickets remaining and pace. What
// each view holds is Seam B's.

describe('the Inputs screen in the browser build', () => {
  let team: Forecasting

  beforeEach(async () => {
    team = (await forecastingForTest()).browserBuild()
  })

  test('empty: each input a numbered section, no setup, and pace a range or typed counts', async () => {
    const page = await screen(team)

    expect(text(one(page, 'h1'))).toBe('Inputs')
    expect(allByRole(page, 'region').map((region) => accessibleName(region))).toEqual(['Milestone', 'Cadence', 'Pace', 'Ambiguity', 'Growth'])
    expect(allByRole(section(page, 'Milestone'), 'textbox').map((field) => [accessibleName(field), field.getAttribute('value')])).toEqual([['Name', '']])
    expect(allByRole(byRole(page, 'group', { name: 'Pace the forecast uses' }), 'radio').map((radio) => accessibleName(radio))).toEqual([
      'Range',
      'Typed counts',
    ])
    expect(all(page, '.setup-summary')).toEqual([])
    expect(hasRole(page, 'alert')).toBe(false)
    expect(text(page)).not.toContain('⚠')
  })

  test('a form refused: why, in its own section, the field as typed', async () => {
    const page = await refused(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: 'lots' })

    const milestone = section(page, 'Milestone')
    expect(text(byRole(milestone, 'alert'))).toMatch(/tickets remaining/i)
    expect(byRole(milestone, 'spinbutton', { name: 'Tickets remaining' }).getAttribute('value')).toBe('lots')
    expect(allByRole(page, 'alert')).toHaveLength(1)
  })

  test('the pace refused: why, beside the range', async () => {
    const page = await refused(team, { kind: 'setPaceRange', low: '8', high: '4' })

    expect(around(byRole(section(page, 'Pace'), 'alert'), 'form').id).toBe('pace-range')
  })

  test('warnings beside the input they are about, and the trend beside the typed counts in use', async () => {
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await submitInputs(team, { kind: 'setPaceCounts', counts: '5, 6, 4, 7, 5' })
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'counts' })
    const page = await screen(team)

    const counts = one(page, '#pace-counts')
    expect(text(counts)).toMatch(/⚠ /)
    expect(accessibleName(byRole(counts, 'img'))).toMatch(/^Pace trend: typed counts of 5, 6, 4, 7, 5, oldest first/)
    expect(text(around(byRole(page, 'radio', { name: 'Typed counts' }), 'fieldset'))).toBe('Range Typed counts')
    expect(byRole(page, 'radio', { name: 'Typed counts' }).hasAttribute('checked')).toBe(true)
  })
})

describe('the Inputs screen with setup', () => {
  test('setup open on first launch: the Connect step, its steps listed, before the inputs', async () => {
    const page = await screen(await forecastingForTest({ setupOpen: true }))

    expect(allByRole(page, 'region').map((region) => accessibleName(region))).toEqual(['Connect', 'Milestone', 'Cadence', 'Pace', 'Ambiguity', 'Growth'])
    const connect = section(page, 'Connect')
    byRole(connect, 'list', { name: 'Setup steps' })
    byRole(connect, 'button', { name: 'Connect' })
  })

  test('connected: the Milestone step, its choices to pick', async () => {
    const team = await forecastingForTest({ setupOpen: true, connected: true })
    const page = await screen(team)

    const step = section(page, 'Milestone’s tickets')
    byRole(step, 'button', { name: 'Checkout v2 milestone' })
    expect(byRole(byRole(step, 'list', { name: 'Setup steps' }), 'listitem', { name: 'Milestone' }).getAttribute('aria-current')).toBe('step')
  })

  test('the Comparable work step, with the candidates opened', async () => {
    const team = await forecastingForTest({
      setupOpen: true,
      connected: true,
      fixture: { ...checkoutFixture(TICKETS), milestoneChoices: [{ kind: 'label', choices: [label('payments')], pastLimit: false }] },
    })
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await pick(team, READ_AT)
    const page = await screen(team, { step: 'comparableWork', opened: [label('payments').query] })

    const step = section(page, 'Comparable work')
    byRole(step, 'link', { name: 'How payments runs' })
    byRole(step, 'heading', { name: 'Candidates' })
    expect(one(step, '.candidates').getAttribute('data-opening')).toBe('opening-1')
  })

  test('the Check step, its rows read from the steps’ picks', async () => {
    const team = await forecastingForTest({ setupOpen: true, connected: true, fixture: checkoutFixture(TICKETS) })
    await pick(team, READ_AT)
    const page = await screen(team, { step: 'check' })

    const check = section(page, 'Check')
    expect(text(byRole(check, 'row', { name: /^Tickets remaining/ }))).toMatch(/^Tickets remaining — 34 GitHub Typed Choose$/)
    byRole(check, 'button', { name: 'Use these' })
  })

  test('done: the summary above the inputs, and no setup step', async () => {
    const team = await forecastingForTest({ connected: true, fixture: checkoutFixture(TICKETS) })
    await pick(team, READ_AT)
    const page = await screen(team)

    expect(text(one(page, '.setup-summary'))).toMatch(/^GitHub · shop-team\/shop read 12 Nov 09:00 Read again Change Milestone Checkout v2 \(milestone\)/)
    expect(allByRole(page, 'region').map((region) => accessibleName(region))).toEqual(['Milestone', 'Cadence', 'Pace', 'Ambiguity', 'Growth'])
  })

  test('connecting skipped: says no tracker is connected', async () => {
    const team = await forecastingForTest({ setupOpen: true })
    await team.submit({ form: 'setup', edit: { kind: 'skipConnecting' } })

    expect(text(one(await screen(team), '.setup-summary'))).toBe('No tracker connected. Connect a tracker')
  })
})
