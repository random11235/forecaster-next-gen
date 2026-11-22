import { beforeEach, describe, expect, test } from 'vitest'
import { checkoutFixture, CONNECTIONS, forecastingForTest, pick, submitInputs, type ForecastingForTest } from '../../forecast/forecastingForTest.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, one, radios, text } from '../dom.js'
import { hidden, READ_AT, screen, section, START, TICKETS } from './inputsScreenHarness.js'

// The Inputs screen (#236), rendered from the views Seam B gives (see inputsScreenHarness.ts): each source of tickets
// remaining and pace, with the chip on a typed value the tracker reads differently. What each view holds is Seam B's.

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
    expect(hidden(one(milestone, 'form#follow-tickets'))).toEqual(['/inputs/tickets-source#milestone', [['ticketsSource', 'tracker']]])
    expect(hidden(one(milestone, 'form#open-tickets-reading'))).toEqual(['/inputs/reading-opened', [['reading', 'ticketsRemaining']]])
  })

  test('tickets remaining typed, its reading opened: the chip with no dot', async () => {
    await submitInputs(team, { kind: 'openReading', reading: 'ticketsRemaining' })
    const milestone = section(await screen(team), 'Milestone')

    const chip = byRole(milestone, 'button', { name: 'GitHub reads differently' })
    expect(all(chip, '.dot')).toEqual([])
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
    one(chip, 'summary .dot')
    chip.setAttribute('open', '')
    expect(accessibleName(byRole(chip, 'img'))).toMatch(/^Finished tickets per week, oldest first: /)
    expect(byRole(chip, 'button', { name: 'Follow GitHub' }).getAttribute('form')).toBe('follow-pace')
    expect(hidden(one(pace, 'form#follow-pace'))).toEqual(['/inputs/pace-mode#pace', [['paceMode', 'tracker']]])
    expect(hidden(one(pace, 'form#open-pace-reading'))).toEqual(['/inputs/reading-opened', [['reading', 'pace']]])
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
