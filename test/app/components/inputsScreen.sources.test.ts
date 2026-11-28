import { beforeEach, describe, expect, test } from 'vitest'
import {
  CHECKOUT,
  checkoutFixture,
  CONNECTIONS,
  forecastingForTest,
  outcomeOf,
  pick,
  readAgain,
  submitInputs,
  type ForecastingForTest,
} from '../../forecast/forecastingForTest.js'
import { finishedInWeeks, open } from '../../trackerScenario.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, one, postsTo, radios, text } from '../dom.js'
import { drawn, milestoneOn, READ_AT, screen, section, START, TICKETS, WEEKS, whatItPosts } from './inputsScreenHarness.js'

// The Inputs screen (#236), rendered from the views Seam B gives (see inputsScreenHarness.ts): each source of tickets
// remaining and pace, with the chip on a typed value the tracker reads differently. What each view holds is Seam B's.

describe('each source of tickets remaining and pace', () => {
  let team: ForecastingForTest

  beforeEach(async () => {
    team = await milestoneOn(await forecastingForTest({ fixture: checkoutFixture(TICKETS) }))
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
    expect(whatItPosts(one(milestone, 'form#follow-tickets'))).toEqual(['/inputs/tickets-source#milestone', [['ticketsSource', 'tracker']]])
    expect(whatItPosts(one(milestone, 'form#open-tickets-reading'))).toEqual(['/inputs/reading-opened', [['reading', 'ticketsRemaining']]])
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
    expect(all(milestone, '.was')).toEqual([])
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
    expect(whatItPosts(one(pace, 'form#follow-pace'))).toEqual(['/inputs/pace-mode#pace', [['paceMode', 'tracker']]])
    expect(whatItPosts(one(pace, 'form#open-pace-reading'))).toEqual(['/inputs/reading-opened', [['reading', 'pace']]])
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
    // the trend of the pace in use, beside the tracker's weeks
    byRole(following, 'img', { name: /^Pace trend/ })
    expect(hasRole(pace, 'button', { name: 'GitHub reads differently' })).toBe(false)
    expect(all(following, '.was')).toEqual([])
    const weeks = one(following, 'details')
    expect(text(one(weeks, 'summary'))).toBe('Show weeks')
    weeks.setAttribute('open', '')
    expect(text(weeks)).toContain('Skip a week that says nothing about the pace ahead (a holiday, say), and the one before counts instead.')
    // a block for each week, holding its count, which posts them all as typed counts
    expect(allByRole(weeks, 'spinbutton').map((block) => block.getAttribute('value'))).toEqual(['5', '6', '4', '7', '5', '6', '8'])
    expect(postsTo(byRole(weeks, 'button', { name: 'Use as typed counts' }))).toBe('/inputs/pace-weeks#pace-counts')
    expect(
      allByRole(weeks, 'button', { name: 'skip' }).map((skip) => [skip.getAttribute('formaction'), skip.getAttribute('name'), skip.getAttribute('value')]),
    ).toEqual(WEEKS.map((week) => ['/inputs/pace-skip#pace-tracker', 'period', week]))
  })

  test('pace following GitHub: a bar for each week, a quiet one a stub', async () => {
    const quiet = await forecastingForTest({ fixture: checkoutFixture([...open(34), ...finishedInWeeks(WEEKS, [5, 6, 0, 7, 5, 6, 8])]), connected: true })
    await submitInputs(quiet, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await pick(quiet, READ_AT)
    await submitInputs(quiet, { kind: 'setPaceMode', paceMode: 'tracker' })
    const following = one(section(await screen(quiet), 'Pace'), '#pace-tracker')

    expect(all(following, '.pace-bars .bar')).toHaveLength(7)
    expect(all(following, '.pace-bars .bar.zero')).toHaveLength(1)
  })

  test('pace following GitHub: under the bars, the current week, left out until it ends, with what it finished so far (#390)', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    const following = one(section(await screen(team), 'Pace'), '#pace-tracker')

    expect(all(following, '.reading-line').map(text)).toContain('This week, from 9 Nov, counts once it ends: none finished so far.')
  })

  test('pace following GitHub, ended at finished comparable work: under the line, where it stops (#411)', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    const view = await team.inputsScreen()
    const pace = view.inputs.milestone.trackerPace
    const lastFinished = 'To the last finished ticket, 13 Oct: comparable work has no open tickets.'
    if (!pace?.reading) throw new Error('Expected GitHub’s pace')
    const milestone = { ...view.inputs.milestone, trackerPace: { ...pace, reading: { ...pace.reading, lastFinished } } }
    const following = one(section(drawn({ ...view, inputs: { ...view.inputs, milestone } }), 'Pace'), '#pace-tracker')

    expect(all(following, '.reading-line').map(text).slice(0, 3)).toEqual([pace.reading.line, pace.reading.firstFinished, lastFinished])
  })

  test('following GitHub after a new read: each value shows faintly what it replaced, and when that was read', async () => {
    await submitInputs(team, { kind: 'setTicketsSource', ticketsSource: 'tracker' })
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    team.fixture.reads[CHECKOUT.query] = { tickets: [...open(31), ...finishedInWeeks(WEEKS, [5, 6, 4, 7, 5, 6, 11])], incomplete: false }
    await readAgain(team, '2026-11-12T14:30:00Z')
    const page = await screen(team)

    expect(text(one(section(page, 'Milestone'), '.was'))).toBe('was 34 on 12 Nov 09:00')
    expect(text(one(page, '#pace-tracker .was'))).toBe('was 5, 6, 4, 7, 5, 6, 8 on 12 Nov 09:00')
  })

  test('a week skipped: shown as a gap, said so, with a way to count it again', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    await team.submit({ form: 'skip', edit: { kind: 'skip', periods: ['2026-10-12'] } })
    const following = one(section(await screen(team), 'Pace'), '#pace-tracker')

    expect(accessibleName(byRole(following, 'img', { name: /^Finished tickets/ }))).toContain('skipped')
    expect(all(following, '.pace-bars .bar.gap')).toHaveLength(1)
    byRole(following, 'button', { name: 'count it again' })
    expect(one(following, 'details').hasAttribute('open')).toBe(true)
    const skipped = one(following, '.block.skipped')
    expect(text(skipped)).toBe('7 12 Oct count')
    // its count struck through
    expect(text(one(skipped, 's'))).toBe('7')
    const count = byRole(skipped, 'button', { name: 'count' })
    expect([count.getAttribute('formaction'), count.getAttribute('name'), count.getAttribute('value')]).toEqual([
      '/inputs/pace-count-again#pace-tracker',
      'period',
      '2026-10-12',
    ])
  })

  test('two weeks skipped: count them again posts both', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    await team.submit({ form: 'skip', edit: { kind: 'skip', periods: ['2026-10-12', '2026-10-19'] } })
    const following = one(section(await screen(team), 'Pace'), '#pace-tracker')

    expect(whatItPosts(around(byRole(following, 'button', { name: 'count them again' }), 'form'))).toEqual([
      '/inputs/pace-count-again#pace-tracker',
      [
        ['period', '2026-10-12'],
        ['period', '2026-10-19'],
      ],
    ])
  })

  test('a skip refused: why, under the tracker’s heading', async () => {
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    const { view } = outcomeOf(await team.submit({ form: 'skip', edit: { kind: 'skip', periods: [] } }), 'refused')
    const following = one(drawn(view), '#pace-tracker')

    expect(text(following)).toMatch(/^GitHub Choose a week to skip\. /)
    byRole(following, 'alert')
  })
})

describe('a source read from Jira', () => {
  test('tickets remaining typed, read differently: the chip names Jira, its reading, and Follow Jira; the tracker’s pace too', async () => {
    const team = await milestoneOn(await forecastingForTest({ fixture: checkoutFixture(TICKETS) }), { connection: CONNECTIONS.jira })
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

describe('a source the tracker can’t give', () => {
  /** Connected to GitHub, the milestone entered, its tickets picked if `picked`, then each value following GitHub. */
  async function following(team: ForecastingForTest, picked: boolean) {
    await milestoneOn(team, { picked })
    await submitInputs(team, { kind: 'setTicketsSource', ticketsSource: 'tracker' })
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'tracker' })
    return screen(team)
  }

  test('an incomplete read: tickets remaining and pace each marked incomplete, saying why', async () => {
    const fixture = { ...checkoutFixture(), reads: { [CHECKOUT.query]: { tickets: TICKETS, incomplete: true } } }
    const page = await following(await forecastingForTest({ fixture }), true)

    const milestone = section(page, 'Milestone')
    expect(text(one(milestone, '.reading'))).toBe('34 incomplete tickets remaining · GitHub, read 12 Nov 09:00')
    expect(text(milestone)).toContain('GitHub gave only part of the milestone’s tickets')
    const pace = one(page, '#pace-tracker')
    expect(text(pace)).toContain('weeks finished · GitHub, read in part incomplete')
    expect(text(pace)).toContain('GitHub gave only part of the finished tickets its queries match')
  })

  test('not read yet: each says so', async () => {
    const page = await following(await forecastingForTest({ fixture: checkoutFixture(TICKETS) }), false)

    expect(text(one(section(page, 'Milestone'), '.reading'))).toBe('tickets remaining · GitHub, not read yet')
    expect(text(one(page, '#pace-tracker'))).toContain('weeks finished · GitHub, not read yet')
  })
})
