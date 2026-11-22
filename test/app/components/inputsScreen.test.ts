import { beforeEach, describe, expect, test } from 'vitest'
import { renderInputsScreen } from '../../../src/app/inputsScreen.js'
import type { Forecasting, InputsEdit, InputsOpening, InputsScreen } from '../../../src/forecast/index.js'
import { checkoutFixture, CONNECTIONS, forecastingForTest, pick, submitInputs, type ForecastingForTest } from '../../forecast/forecastingForTest.js'
import { finishedInWeeks, label, open } from '../../trackerScenario.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, one, radios, render, text } from '../dom.js'

// The Inputs screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts), started no
// server: empty, refused, warned, each setup step and its summary, and each source of tickets remaining and pace, with
// the chip on a typed value the tracker reads differently. What each view holds is Seam B's.

const READ_AT = '2026-11-12T09:00:00Z'
const START = '2026-08-31'
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
// GitHub reads 34 tickets remaining, and 5, 6, 4, 7, 5, 6, 8 finished in the weeks it reads whole
const TICKETS = [...open(34), ...finishedInWeeks(WEEKS, [5, 6, 4, 7, 5, 6, 8])]

/** The screen as `renderInputsScreen` draws `view`, its candidates' opening, if it has one, kept as `opening-1`. */
const drawn = (view: InputsScreen) => render(renderInputsScreen(view, () => 'opening-1'))
const screen = async (team: Forecasting, opening?: InputsOpening) => drawn(await team.inputsScreen(opening))
const section = (page: ReturnType<typeof render>, name: string) => byRole(page, 'region', { name })
const refused = async (team: Forecasting, edit: InputsEdit) => {
  const outcome = await submitInputs(team, edit)
  if (outcome.kind !== 'refused') throw new Error(`Expected the form refused, but it was ${outcome.kind}`)
  return drawn(outcome.view)
}

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

describe('each source of tickets remaining and pace', () => {
  let team: ForecastingForTest

  beforeEach(async () => {
    team = await forecastingForTest({ fixture: checkoutFixture(TICKETS) })
    await team.submit({ form: 'connection', edit: CONNECTIONS.github })
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    await pick(team, READ_AT)
  })

  test('tickets remaining typed, read differently: the chip, with its dot, the reading, and Follow GitHub', async () => {
    const milestone = section(await screen(team), 'Milestone')

    expect(radios(byRole(milestone, 'group', { name: 'Where tickets remaining comes from' }))).toEqual([
      ['GitHub', false],
      ['Typed', true],
    ])
    expect(byRole(milestone, 'spinbutton', { name: 'Tickets remaining' }).getAttribute('value')).toBe('40')
    const chip = byRole(milestone, 'button', { name: 'GitHub reads differently' })
    one(chip, '.dot')
    const opened = around(chip, 'details')
    opened.setAttribute('open', '')
    expect(text(opened)).toBe('GitHub reads differently GitHub reads 34 tickets remaining, read 12 Nov 09:00. Follow GitHub')
    expect(byRole(opened, 'button', { name: 'Follow GitHub' }).getAttribute('form')).toBe('follow-tickets')
  })

  test('tickets remaining following GitHub: its reading, with no field to type in and no chip', async () => {
    await submitInputs(team, { kind: 'setTicketsSource', ticketsSource: 'tracker' })
    const milestone = section(await screen(team), 'Milestone')

    expect(text(one(milestone, '.reading'))).toBe('34 tickets remaining · GitHub, read 12 Nov 09:00')
    expect(hasRole(milestone, 'spinbutton', { name: 'Tickets remaining' })).toBe(false)
    expect(hasRole(milestone, 'button', { name: 'GitHub reads differently' })).toBe(false)
  })

  test('pace a range, read differently: the chip on the range, GitHub’s weeks as bars inside it', async () => {
    await submitInputs(team, { kind: 'setPaceRange', low: '2', high: '3' })
    const pace = section(await screen(team), 'Pace')

    expect(radios(byRole(pace, 'group', { name: 'Pace the forecast uses' }))).toEqual([
      ['GitHub', false],
      ['Typed counts', false],
      ['Range', true],
    ])
    const chip = around(byRole(pace, 'button', { name: 'GitHub reads differently' }), 'details')
    expect(around(chip, 'form').id).toBe('pace-range')
    chip.setAttribute('open', '')
    expect(accessibleName(byRole(chip, 'img'))).toMatch(/^Finished tickets per week, oldest first: /)
  })

  test('pace typed counts, read differently: the chip on the counts, GitHub’s weeks as bars inside it', async () => {
    await submitInputs(team, { kind: 'setPaceCounts', counts: '1, 1, 1, 1, 1' })
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'counts' })
    const pace = section(await screen(team), 'Pace')

    expect(radios(byRole(pace, 'group', { name: 'Pace the forecast uses' })).find(([, checked]) => checked)?.[0]).toBe('Typed counts')
    const chip = around(byRole(pace, 'button', { name: 'GitHub reads differently' }), 'details')
    expect(around(chip, 'form').id).toBe('pace-counts')
    chip.setAttribute('open', '')
    expect(accessibleName(byRole(chip, 'img'))).toMatch(/^Finished tickets per week, oldest first: /)
  })

  test('pace following GitHub: its weeks as bars, the line, and the weeks to type into or skip', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    const pace = section(await screen(team), 'Pace')

    const following = one(pace, '#pace-tracker')
    expect(text(byRole(following, 'heading'))).toBe('GitHub')
    expect(accessibleName(byRole(following, 'img', { name: /^Finished tickets/ }))).toMatch(/oldest first: (\d+, )+\d+$/)
    expect(hasRole(pace, 'button', { name: 'GitHub reads differently' })).toBe(false)
    const weeks = one(following, 'details')
    expect(text(one(weeks, 'summary'))).toBe('Show weeks')
    weeks.setAttribute('open', '')
    expect(allByRole(weeks, 'button', { name: 'skip' }).length).toBeGreaterThan(0)
    byRole(weeks, 'button', { name: 'Use as typed counts' })
  })

  test('a week skipped: shown as a gap, said so, with a way to count it again', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    await team.submit({ form: 'skip', edit: { kind: 'skip', periods: ['2026-10-12'] } })
    const following = one(section(await screen(team), 'Pace'), '#pace-tracker')

    expect(accessibleName(byRole(following, 'img', { name: /^Finished tickets/ }))).toContain('skipped')
    byRole(following, 'button', { name: 'count it again' })
    expect(one(following, 'details').hasAttribute('open')).toBe(true)
  })
})

describe('a source read from Jira', () => {
  test('tickets remaining typed, read differently: the chip names Jira, its reading, and Follow Jira; the tracker’s pace too', async () => {
    const team = await forecastingForTest({ fixture: checkoutFixture(TICKETS) })
    await team.submit({ form: 'connection', edit: CONNECTIONS.jira })
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    await pick(team, READ_AT)
    const page = await screen(team)

    const milestone = section(page, 'Milestone')
    expect(radios(byRole(milestone, 'group', { name: 'Where tickets remaining comes from' }))).toEqual([
      ['Jira', false],
      ['Typed', true],
    ])
    const chip = around(byRole(milestone, 'button', { name: 'Jira reads differently' }), 'details')
    chip.setAttribute('open', '')
    expect(text(chip)).toBe('Jira reads differently Jira reads 34 tickets remaining, read 12 Nov 09:00. Follow Jira')
    expect(radios(byRole(section(page, 'Pace'), 'group', { name: 'Pace the forecast uses' }))[0]).toEqual(['Jira', false])
  })
})
