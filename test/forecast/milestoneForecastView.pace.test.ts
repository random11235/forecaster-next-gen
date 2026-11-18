import { describe, expect, test } from 'vitest'
import type { InputsEdit } from '../../src/forecast/inputs.js'
import type { Storage } from '../../src/storage/storage.js'
import { openStorage, newTeam, mediumGrowth, edit, enter, DATES_FROM_1_SEP, view, inputsScreenView } from './forecastViewScenario.js'

// Seam B: the forecast's cadence, and its pace as typed counts. Arranged through forecastViewScenario.ts.

describe('the cadence', () => {
  test('10 tickets at exactly 5 a sprint of 14 days, with no growth, finish 2 sprints after the start date, and the horizon is 156 sprints', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceRange', low: '5', high: '5' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      cadenceDays: 14,
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-29' })),
      horizonDate: '2032-08-24',
    })
  })

  test('changing the cadence keeps the pace as typed, so 4–8 a sprint of 14 days lands every date later than 4–8 a week', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    const forecast = view(storage)
    expect(forecast).toMatchObject({ cadenceDays: 14, pace: { source: 'range', low: 4, high: 8 }, paceSaid: '4–8 tickets per sprint (range)' })
    if (forecast.kind !== 'forecast') throw new Error('expected a forecast')
    forecast.dates.forEach(({ date }, index) => expect(date !== null && date > DATES_FROM_1_SEP[index]!.date).toBe(true))
  })

  test('changing the cadence after the pace is entered warns that the cadence length has changed, beside the pace and on the forecast', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      kind: 'forecast',
      warnings: [{ input: 'pace', message: 'Pace: cadence length has changed. Please verify that the per period numbers are aligned.' }],
    })
    expect(inputsScreenView(storage).milestone.notes).toEqual([
      { input: 'pace', message: 'Cadence length has changed. Please verify that the per period numbers are aligned.' },
    ])
  })

  test('a forecast at the untouched cadence is in 7-day periods', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toMatchObject({ cadenceDays: 7, dates: DATES_FROM_1_SEP, horizonDate: '2029-08-28' })
  })

  test('at a 14-day cadence, zero pace warns of 0 tickets a sprint, beside the pace and on the forecast', () => {
    const storage = newTeam()
    expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceRange', low: '0', high: '0' })).toEqual({ ok: true })

    const warning = { input: 'pace', message: 'At 0 tickets a sprint, the work never finishes.' }
    expect(view(storage)).toMatchObject({ warnings: [warning] })
    expect(inputsScreenView(storage).milestone.notes).toEqual([warning])
  })

  test('at a 14-day cadence, a pace too high to be real is refused per sprint', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceRange', low: '4', high: '1001' })).toEqual({ ok: false, error: 'Enter at most 1000 tickets per sprint.' })
  })

  test('the cadence is kept across a restart', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(inputsScreenView(openStorage()).milestone.cadenceDays).toBe(14)
    expect(view(openStorage())).toMatchObject({ cadenceDays: 14, horizonDate: '2032-08-24' })
  })
})

describe('a pace entered for a different cadence', () => {
  const CADENCE_CHANGED = 'Pace: cadence length has changed. Please verify that the per period numbers are aligned.'

  /** 100 tickets at 4–8 a week, entered at the untouched cadence, which then changes to 14 days. */
  function enteredWeeklyThenSprints(): Storage {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })
    expect(view(storage)).toMatchObject({ warnings: [{ input: 'pace', message: CADENCE_CHANGED }] })
    return storage
  }

  test.each<[string, InputsEdit]>([
    ['the pace range', { kind: 'setPaceRange', low: '8', high: '16' }],
    ['the typed counts', { kind: 'setPaceCounts', counts: '9, 12' }],
    ['a typed count added', { kind: 'addPaceCount', count: '9' }],
    ['the cadence changed back to 7 days', { kind: 'setCadence', cadenceDays: '7' }],
  ])('editing %s clears the warning', (_, change) => {
    const storage = enteredWeeklyThenSprints()

    expect(edit(storage, change)).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ warnings: [] })
    expect(inputsScreenView(storage).milestone.notes).toEqual([])
  })

  test('choosing the other pace, or removing the last typed count, keeps the warning', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7, 5, 8, 6, 7' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'removeLastPaceCount' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ warnings: expect.arrayContaining([{ input: 'pace', message: CADENCE_CHANGED }]) })
  })

  test('changing the cadence before any pace is entered gives no warning', () => {
    const storage = newTeam()
    expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '100' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(inputsScreenView(storage).milestone.notes).toEqual([{ input: 'pace', message: 'Enter a pace range.' }])
  })

  test('from one sprint length to another, warns again', () => {
    const storage = enteredWeeklyThenSprints()
    expect(edit(storage, { kind: 'setPaceRange', low: '8', high: '16' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '10' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ warnings: [{ input: 'pace', message: CADENCE_CHANGED }] })
    expect(inputsScreenView(storage).milestone.notes).toEqual([
      { input: 'pace', message: 'Cadence length has changed. Please verify that the per period numbers are aligned.' },
    ])
  })

  test('the warning is kept across a restart', () => {
    enteredWeeklyThenSprints()

    expect(view(openStorage())).toMatchObject({ warnings: [{ input: 'pace', message: CADENCE_CHANGED }] })
  })
})

describe('typed counts', () => {
  test('10 tickets from counts of exactly 5 a week, with no growth, finish 2 weeks after the start date, and the forecast says the pace it used', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceCounts', counts: '5, 5, 5, 5, 5, 5, 5, 5' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      kind: 'forecast',
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
      pace: { source: 'counts', counts: [5, 5, 5, 5, 5, 5, 5, 5] },
      paceSaid: 'typed counts, 8 weeks',
      warnings: [],
    })
  })

  test('with 3 typed counts there is no forecast, and the note saying why sits beside the pace too', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })

    const note = {
      input: 'typedCounts',
      message: 'Typed counts: 3 weeks entered. The forecast needs at least 4. Add another count, or switch pace to the range.',
    }
    expect(view(storage)).toEqual({ kind: 'problems', name: 'Checkout v2', problems: [note] })
    expect(inputsScreenView(storage).milestone.notes).toEqual([note])
  })

  test.each([
    ['6, 4, 9, 7', 4],
    ['6, 4, 9, 7, 5, 8, 6', 7],
  ])('with typed counts %s in use, the forecast warns it needs 8 to be reliable, and the Inputs screen says so beside the pace', (counts, entered) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      kind: 'forecast',
      warnings: [{ input: 'typedCounts', message: `Typed counts: ${entered} weeks entered. The forecast needs 8 to be reliable.` }],
    })
    expect(inputsScreenView(storage).milestone.notes).toEqual([{ input: 'typedCounts', message: `${entered} of 8 needed for reliable results` }])
  })

  test('at a 14-day cadence, the reliability warning counts sprints', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      warnings: [{ input: 'typedCounts', message: 'Typed counts: 4 sprints entered. The forecast needs 8 to be reliable.' }],
    })
  })

  test('with the range in use beside 4 typed counts, or 8 typed counts in use, nothing warns about the typed counts', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7' })).toEqual({ ok: true })
    expect(view(storage)).toMatchObject({ kind: 'forecast', pace: { source: 'range' }, warnings: [] })
    expect(inputsScreenView(storage).milestone.notes).toEqual([])

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7, 5, 8, 6, 7' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ kind: 'forecast', pace: { source: 'counts' }, warnings: [] })
    expect(inputsScreenView(storage).milestone.notes).toEqual([])
  })

  test('the EM adds a count, removes the last one, and edits the list, oldest first, and the counts are kept across a restart', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    const counts = () => inputsScreenView(openStorage()).milestone.paceCounts

    expect(edit(storage, { kind: 'setPaceCounts', counts: '6 4, 9' })).toEqual({ ok: true })
    expect(counts()).toEqual([6, 4, 9])

    expect(edit(openStorage(), { kind: 'addPaceCount', count: ' 7 ' })).toEqual({ ok: true })
    expect(counts()).toEqual([6, 4, 9, 7])

    expect(edit(openStorage(), { kind: 'removeLastPaceCount' })).toEqual({ ok: true })
    expect(counts()).toEqual([6, 4, 9])
  })

  test('removing the last count from none changes nothing', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(edit(storage, { kind: 'removeLastPaceCount' })).toEqual({ ok: true })

    expect(inputsScreenView(storage).milestone.paceCounts).toEqual([])
  })

  test('switching between the range and typed counts keeps both across a restart, and the forecast uses the one chosen', () => {
    let storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '10, 10, 10, 10' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    storage = openStorage()
    expect(view(storage)).toMatchObject({
      pace: { source: 'counts', counts: [10, 10, 10, 10] },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-08' })),
    })
    expect(inputsScreenView(storage).milestone).toMatchObject({ paceMode: 'counts', paceRange: { low: 5, high: 5 } })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'range' })).toEqual({ ok: true })
    storage = openStorage()
    expect(view(storage)).toMatchObject({
      pace: { source: 'range', low: 5, high: 5 },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
    })
    expect(inputsScreenView(storage).milestone).toMatchObject({ paceMode: 'range', paceCounts: [10, 10, 10, 10] })
  })

  test('typed counts of 0 throughout give no date, and a warning on the pace', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '0, 0, 0, 0, 0, 0, 0, 0' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null })),
      warnings: [{ input: 'pace', message: 'At 0 tickets a week, the work never finishes.' }],
    })
  })

  test.each([
    [{ kind: 'setPaceCounts', counts: '6, -1' }, 'Enter typed counts as whole numbers of tickets, 0 or more.'],
    [{ kind: 'setPaceCounts', counts: '6, 2.5' }, 'Enter typed counts as whole numbers of tickets, 0 or more.'],
    [{ kind: 'setPaceCounts', counts: 'six' }, 'Enter typed counts as whole numbers of tickets, 0 or more.'],
    [{ kind: 'setPaceCounts', counts: '6, 1001' }, 'Enter at most 1000 tickets per week.'],
    [{ kind: 'addPaceCount', count: '' }, 'Enter typed counts as whole numbers of tickets, 0 or more.'],
    [{ kind: 'addPaceCount', count: '-3' }, 'Enter typed counts as whole numbers of tickets, 0 or more.'],
    [{ kind: 'addPaceCount', count: '4 5' }, 'Enter typed counts as whole numbers of tickets, 0 or more.'],
    [{ kind: 'addPaceCount', count: '1001' }, 'Enter at most 1000 tickets per week.'],
    [{ kind: 'setPaceMode', paceMode: 'measured' }, 'Choose the range or typed counts.'],
    // the tracker's pace isn't offered yet (#159)
    [{ kind: 'setPaceMode', paceMode: 'tracker' }, 'Choose the range or typed counts.'],
  ] satisfies [InputsEdit, string][])('refuses %j, saying why and changing nothing', (change, error) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    const before = view(storage)

    expect(edit(storage, change)).toEqual({ ok: false, error })

    expect(view(storage)).toEqual(before)
    expect(inputsScreenView(storage).milestone.paceCounts).toEqual([6, 4, 9])
  })

  test.each([
    { kind: 'setPaceCounts', counts: '6, 4' },
    { kind: 'addPaceCount', count: '6' },
    { kind: 'removeLastPaceCount' },
    { kind: 'setPaceMode', paceMode: 'counts' },
  ] satisfies InputsEdit[])('%j needs the milestone first', (change) => {
    const storage = newTeam()

    expect(edit(storage, change)).toEqual({ ok: false, error: 'Enter the milestone first.' })

    expect(view(storage)).toEqual({ kind: 'empty' })
  })

  test('with no typed counts at a 14-day cadence, the note counts sprints', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      kind: 'problems',
      problems: [{ message: 'Typed counts: 0 sprints entered. The forecast needs at least 4. Add another count, or switch pace to the range.' }],
    })
  })
})
