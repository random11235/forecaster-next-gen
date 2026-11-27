import type { Forecasting, InputsEdit } from '../../../src/forecast/index.js'
import { beforeEach, describe, expect, test } from 'vitest'
import { checkoutFixture, forecastingForTest, outcomeOf, pick, submitInputs } from '../../forecast/forecastingForTest.js'
import { label } from '../../trackerScenario.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, one, postsTo, radios, render, text } from '../dom.js'
import { drawn, READ_AT, refused, screen, section, START, TICKETS } from './inputsScreenHarness.js'

// The Inputs screen (#236), rendered from the views Seam B gives (see inputsScreenHarness.ts): empty, refused, warned,
// and each setup step and its summary; inputsScreen.sources.test.ts has each source of tickets remaining and pace. What
// each view holds is Seam B's.

/** Each section's name and the number it is given on the screen, in order. */
const numbered = (page: ReturnType<typeof render>) => allByRole(page, 'region').map((region) => [accessibleName(region), text(one(region, '.number'))])

describe('the Inputs screen in the browser build', () => {
  let team: Forecasting

  beforeEach(async () => {
    team = (await forecastingForTest()).browserBuild()
  })

  test('empty: each input a numbered section, no setup, and pace a range or typed counts', async () => {
    const page = await screen(team)

    expect(text(one(page, 'h1'))).toBe('Inputs')
    expect(numbered(page)).toEqual([
      ['Milestone', '01'],
      ['Cadence', '02'],
      ['Pace', '03'],
      ['Ambiguity', '04'],
      ['Growth', '05'],
    ])
    const milestone = section(page, 'Milestone')
    expect(allByRole(milestone, 'textbox').map((field) => [accessibleName(field), field.getAttribute('value')])).toEqual([['Name', '']])
    // a date field has no role
    expect(one(milestone, 'input[name="startDate"]').getAttribute('value')).toBe('2026-11-12')
    expect(byRole(milestone, 'spinbutton', { name: 'Tickets remaining' }).getAttribute('value')).toBe('')
    expect(hasRole(milestone, 'group', { name: 'Where tickets remaining comes from' })).toBe(false)
    expect(text(section(page, 'Pace'))).toContain(
      'Typed counts need at least 4 for a forecast, and 8 to be reliable. Capacity is set beside the forecast, under Pace.',
    )
    expect(allByRole(byRole(page, 'group', { name: 'Pace the forecast uses' }), 'radio').map((radio) => accessibleName(radio))).toEqual([
      'Range',
      'Typed counts',
    ])
    // in place of setup, why it reads no tickets, and where they can be read (#396)
    expect(text(one(page, '.setup-summary'))).toBe(
      'This page reads no tracker: type the inputs below. To read the milestone’s tickets from GitHub or Jira, run the Forecaster on your own machine.',
    )
    expect(hasRole(page, 'button', { name: /Connect/ })).toBe(false)
    expect(hasRole(page, 'alert')).toBe(false)
    expect(text(page)).not.toContain('⚠')
  })

  test('every form posts to a fragment naming where it sits, so the browser lands on why, should it be refused; and the fields they carry', async () => {
    const page = await screen(team)

    const forms = all(page, 'form')
    expect(forms.map((form) => form.getAttribute('action'))).toEqual([
      '/inputs/milestone#milestone',
      '/inputs/cadence#cadence',
      '/inputs/pace-mode#pace',
      '/inputs/pace#pace-range',
      '/inputs/pace-counts#pace-counts',
      '/inputs/pace-counts/add#pace-counts',
      '/inputs/pace-counts/remove-last#pace-counts',
      '/inputs/ambiguity#ambiguity',
      '/inputs/growth#growth',
    ])
    for (const form of forms) {
      const where = one(page, `#${form.getAttribute('action')?.split('#')[1]}`)
      const inSection = around(form, 'section')
      expect(where === inSection || inSection.contains(where), String(form.getAttribute('action'))).toBe(true)
    }
    // no committed date, epics, measured pace or growth, workflow, absence or capacity: capacity is typed beside the forecast
    expect([...new Set(all(page, 'input, select, textarea').map((field) => field.getAttribute('name')))]).toEqual([
      'name',
      'startDate',
      'ticketsRemaining',
      'cadenceDays',
      'paceMode',
      'low',
      'high',
      'counts',
      'count',
      'ambiguity',
      'low-low',
      'low-high',
      'medium-low',
      'medium-high',
      'high-low',
      'high-high',
    ])
  })

  test('a milestone saved: its fields as saved, the note beside its start date, and the range per week, its warning inside it', async () => {
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await submitInputs(team, { kind: 'setPaceRange', low: '0', high: '0' })
    const view = await team.inputsScreen()
    const startDateNote = view.inputs.milestone.notes.find(({ input }) => input === 'startDate')
    if (!startDateNote) throw new Error('Expected a note beside the start date')
    const page = drawn(view)

    const milestone = section(page, 'Milestone')
    expect(byRole(milestone, 'textbox', { name: 'Name' }).getAttribute('value')).toBe('Checkout v2')
    const startDate = one(milestone, 'input[name="startDate"]')
    expect(startDate.getAttribute('value')).toBe(START)
    const note = around(startDate, 'label').nextElementSibling
    expect(note && text(note)).toBe(`⚠ ${startDateNote.message}`)
    expect(byRole(milestone, 'spinbutton', { name: 'Tickets remaining' }).getAttribute('value')).toBe('40')
    const range = one(page, '#pace-range')
    expect(allByRole(range, 'spinbutton').map((field) => [accessibleName(field), field.getAttribute('value')])).toEqual([
      ['Low', '0'],
      ['High', '0'],
    ])
    expect(text(range)).toBe('Range Low to High tickets per week ⚠ At 0 tickets a week, the work never finishes. Save and forecast')
  })

  test('the cadence: its length, and what it makes a period; at 14 days a sprint, the pace per sprint', async () => {
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    const cadence = (page: ReturnType<typeof render>) => section(page, 'Cadence')
    const weekly = await screen(team)

    expect(byRole(cadence(weekly), 'spinbutton', { name: 'Cadence length' }).getAttribute('value')).toBe('7')
    expect(text(cadence(weekly))).toContain('At 7 days a period is a week, so pace is entered per week; any other length makes it a sprint.')

    await submitInputs(team, { kind: 'setCadence', cadenceDays: '14' })
    const sprints = await screen(team)

    expect(byRole(cadence(sprints), 'spinbutton', { name: 'Cadence length' }).getAttribute('value')).toBe('14')
    expect(text(cadence(sprints))).toContain('At 14 days a period is a sprint, so pace is entered per sprint; 7 days makes it a week.')
    expect(text(one(sprints, '#pace-range'))).toContain('tickets per sprint')
  })

  test('ambiguity and growth: each level with its range, medium chosen; the ranges as fields, saying how a range grows the work', async () => {
    const page = await screen(team)

    expect(radios(byRole(page, 'group', { name: 'Ambiguity of the milestone' }))).toEqual([
      ['Low 1–1.5×', false],
      ['Medium 1–2×', true],
      ['High 1.5–3×', false],
    ])
    const growth = section(page, 'Growth')
    expect(allByRole(growth, 'spinbutton').map((field) => [accessibleName(field), field.getAttribute('value')])).toEqual([
      ['Low ambiguity, low end', '1'],
      ['Low ambiguity, high end', '1.5'],
      ['Medium ambiguity, low end', '1'],
      ['Medium ambiguity, high end', '2'],
      ['High ambiguity, low end', '1.5'],
      ['High ambiguity, high end', '3'],
    ])
    expect(text(growth)).toContain('× the tickets remaining')
    expect(text(growth)).toContain(
      'Each simulation picks one growth from the range, every value in it equally likely, and multiplies the tickets remaining by it before working through them at the team’s pace. A wider range spreads the finish dates out.',
    )
  })

  const GROWTH = { low: { low: '1', high: '1.5' }, medium: { low: '1', high: '2' }, high: { low: '1.5', high: '3' } }
  test.each<[string, InputsEdit, string, [name: string, value: string] | undefined]>([
    ['the cadence', { kind: 'setCadence', cadenceDays: '0' }, '/inputs/cadence#cadence', ['Cadence length', '0']],
    ['the typed counts', { kind: 'setPaceCounts', counts: '6, -1' }, '/inputs/pace-counts#pace-counts', ['Tickets done each week, oldest first', '6, -1']],
    ['a count to add', { kind: 'addPaceCount', count: '2.5' }, '/inputs/pace-counts#pace-counts', ['Newest week', '2.5']],
    ['the ambiguity', { kind: 'setAmbiguity', level: 'extreme' }, '/inputs/ambiguity#ambiguity', undefined],
    ['the growth ranges', { kind: 'setAmbiguityRanges', ...GROWTH, high: { low: '4', high: '3' } }, '/inputs/growth#growth', ['High ambiguity, low end', '4']],
  ])('%s refused: why, at the top of its own form, the field as typed', async (_, edit, action, typed) => {
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    const page = await refused(team, edit)

    const why = byRole(page, 'alert')
    expect(postsTo(why)).toBe(action)
    expect(text(around(why, 'form')).startsWith(text(why))).toBe(true)
    if (typed)
      expect(
        all(page, 'input')
          .find((field) => accessibleName(field) === typed[0])
          ?.getAttribute('value'),
      ).toBe(typed[1])
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
    expect(numbered(page).slice(0, 2)).toEqual([
      ['Milestone’s tickets', '01'],
      ['Milestone', '02'],
    ])
  })

  test('an Inputs form refused, or saved in place, at the Milestone step: the step first, the inputs numbered after it', async () => {
    const team = await forecastingForTest({ setupOpen: true, connected: true })
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    const inPlace = outcomeOf(await team.submit({ form: 'inputs', edit: { kind: 'setCadence', cadenceDays: '14' } }, { inPlace: true }), 'savedInPlace')

    for (const page of [await refused(team, { kind: 'setCadence', cadenceDays: '0' }), drawn(inPlace.view)])
      expect(numbered(page).slice(0, 3)).toEqual([
        ['Milestone’s tickets', '01'],
        ['Milestone', '02'],
        ['Cadence', '03'],
      ])
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
    expect(numbered(page).slice(0, 2)).toEqual([
      ['Comparable work', '01'],
      ['Milestone', '02'],
    ])
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
    // the summary first, then each input in turn
    expect(all(page, '.setup-summary, section').map((part) => (part.classList.contains('setup-summary') ? 'summary' : accessibleName(part)))).toEqual([
      'summary',
      'Milestone',
      'Cadence',
      'Pace',
      'Ambiguity',
      'Growth',
    ])
  })

  test('connecting skipped: says no tracker is connected', async () => {
    const team = await forecastingForTest({ setupOpen: true })
    await team.submit({ form: 'setup', edit: { kind: 'skipConnecting' } })

    expect(text(one(await screen(team), '.setup-summary'))).toBe('No tracker connected. Connect a tracker')
  })
})
