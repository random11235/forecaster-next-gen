import { describe, expect, test } from 'vitest'
import type { InputsEdit } from '../../src/forecast/index.js'
import { mediumGrowth } from './forecastingForTest.js'
import { newTeam, edit, enter, DATES_FROM_1_SEP, view, inputsScreenView } from './forecastViewScenario.js'

// Seam B: the forecast's cadence, and its pace as typed counts. Arranged through forecastViewScenario.ts.

describe('the cadence', () => {
  test('10 tickets at exactly 5 a sprint of 14 days, with no growth, finish 2 sprints after the start date, and the horizon is 156 sprints', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })
    expect(await edit(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceRange', low: '5', high: '5' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      cadenceDays: 14,
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-29' })),
      horizonDate: '2032-08-24',
    })
  })

  test('changing the cadence keeps the pace as typed, so 4–8 a sprint of 14 days lands every date later than 4–8 a week', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    const forecast = await view(team)
    expect(forecast).toMatchObject({ cadenceDays: 14, pace: { source: 'range', low: 4, high: 8 }, paceSaid: '4–8 tickets per sprint (range)' })
    if (forecast.kind !== 'forecast') throw new Error('expected a forecast')
    forecast.dates.forEach(({ date }, index) => expect(date !== null && date > (DATES_FROM_1_SEP[index]?.date ?? '')).toBe(true))
  })

  test('a range kept through a cadence change is per sprint on both screens, with no warning', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await edit(team, { kind: 'setCadence', cadenceDays: '3' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      kind: 'forecast',
      cadenceDays: 3,
      pace: { source: 'range', low: 4, high: 8 },
      paceSaid: '4–8 tickets per sprint (range)',
      warnings: [],
    })
    expect((await inputsScreenView(team)).milestone).toMatchObject({ cadenceDays: 3, period: 'sprint', paceRange: { low: 4, high: 8 }, notes: [] })
  })

  test('typed counts kept through a cadence change are what the forecast draws from, with no warning', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '2, 4, 6, 8, 4, 5, 3, 3, 0, 5' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setCadence', cadenceDays: '3' })).toEqual({ ok: true })
    team.restart()

    expect(await view(team)).toMatchObject({
      kind: 'forecast',
      cadenceDays: 3,
      pace: { source: 'counts', counts: [2, 4, 6, 8, 4, 5, 3, 3, 0, 5] },
      warnings: [],
    })
    expect((await inputsScreenView(team)).milestone).toMatchObject({ period: 'sprint', paceCounts: [2, 4, 6, 8, 4, 5, 3, 3, 0, 5], notes: [] })
  })

  test('a forecast at the untouched cadence is in 7-day periods', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await view(team)).toMatchObject({ cadenceDays: 7, dates: DATES_FROM_1_SEP, horizonDate: '2029-08-28' })
  })

  test('at a 14-day cadence, zero pace warns of 0 tickets a sprint, beside the pace and on the forecast', async () => {
    const team = await newTeam()
    expect(await edit(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceRange', low: '0', high: '0' })).toEqual({ ok: true })

    const warning = { input: 'pace', message: 'At 0 tickets a sprint, the work never finishes.' }
    expect(await view(team)).toMatchObject({ warnings: [warning] })
    expect((await inputsScreenView(team)).milestone.notes).toEqual([warning])
  })

  test('at a 14-day cadence, a pace too high to be real is refused per sprint', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceRange', low: '4', high: '1001' })).toEqual({ ok: false, error: 'Enter at most 1000 tickets per sprint.' })
  })

  test('the cadence is kept across a restart', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    team.restart()
    expect((await inputsScreenView(team)).milestone.cadenceDays).toBe(14)
    expect(await view(team)).toMatchObject({ cadenceDays: 14, horizonDate: '2032-08-24' })
  })
})

describe('typed counts', () => {
  test('10 tickets from counts of exactly 5 a week, with no growth, finish 2 weeks after the start date, and the forecast says the pace it used', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })
    expect(await edit(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceCounts', counts: '5, 5, 5, 5, 5, 5, 5, 5' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      kind: 'forecast',
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
      pace: { source: 'counts', counts: [5, 5, 5, 5, 5, 5, 5, 5] },
      paceSaid: 'typed counts, 8 weeks',
      warnings: [],
    })
  })

  test('with 3 typed counts there is no forecast, and the note saying why sits beside the pace too', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })

    const note = {
      input: 'typedCounts',
      message: 'Typed counts: 3 weeks entered. The forecast needs at least 4. Add another count, or switch pace to the range.',
    }
    expect(await view(team)).toEqual({ kind: 'problems', name: 'Checkout v2', problems: [note] })
    expect((await inputsScreenView(team)).milestone.notes).toEqual([note])
  })

  test.each([
    ['6, 4, 9, 7', 4],
    ['6, 4, 9, 7, 5, 8, 6', 7],
  ])('with typed counts %s in use, the forecast warns it needs 8 to be reliable, and the Inputs screen says so beside the pace', async (counts, entered) => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      kind: 'forecast',
      warnings: [{ input: 'typedCounts', message: `Typed counts: ${entered} weeks entered. The forecast needs 8 to be reliable.` }],
    })
    expect((await inputsScreenView(team)).milestone.notes).toEqual([{ input: 'typedCounts', message: `${entered} of 8 needed for reliable results` }])
  })

  test('at a 14-day cadence, the reliability warning counts sprints', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9, 7' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      warnings: [{ input: 'typedCounts', message: 'Typed counts: 4 sprints entered. The forecast needs 8 to be reliable.' }],
    })
  })

  test('with the range in use beside 4 typed counts, or 8 typed counts in use, nothing warns about the typed counts', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9, 7' })).toEqual({ ok: true })
    expect(await view(team)).toMatchObject({ kind: 'forecast', pace: { source: 'range' }, warnings: [] })
    expect((await inputsScreenView(team)).milestone.notes).toEqual([])

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9, 7, 5, 8, 6, 7' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({ kind: 'forecast', pace: { source: 'counts' }, warnings: [] })
    expect((await inputsScreenView(team)).milestone.notes).toEqual([])
  })

  test('the EM adds a count, removes the last one, and edits the list, oldest first, and the counts are kept across a restart', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    const counts = async () => {
      team.restart()
      return (await inputsScreenView(team)).milestone.paceCounts
    }

    expect(await edit(team, { kind: 'setPaceCounts', counts: '6 4, 9' })).toEqual({ ok: true })
    expect(await counts()).toEqual([6, 4, 9])

    expect(await edit(team, { kind: 'addPaceCount', count: ' 7 ' })).toEqual({ ok: true })
    expect(await counts()).toEqual([6, 4, 9, 7])

    expect(await edit(team, { kind: 'removeLastPaceCount' })).toEqual({ ok: true })
    expect(await counts()).toEqual([6, 4, 9])
  })

  test('removing the last count from none changes nothing', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(await edit(team, { kind: 'removeLastPaceCount' })).toEqual({ ok: true })

    expect((await inputsScreenView(team)).milestone.paceCounts).toEqual([])
  })

  test('switching between the range and typed counts keeps both across a restart, and the forecast uses the one chosen', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '10, 10, 10, 10' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    team.restart()
    expect(await view(team)).toMatchObject({
      pace: { source: 'counts', counts: [10, 10, 10, 10] },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-08' })),
    })
    expect((await inputsScreenView(team)).milestone).toMatchObject({ paceMode: 'counts', paceRange: { low: 5, high: 5 } })

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'range' })).toEqual({ ok: true })
    team.restart()
    expect(await view(team)).toMatchObject({
      pace: { source: 'range', low: 5, high: 5 },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
    })
    expect((await inputsScreenView(team)).milestone).toMatchObject({ paceMode: 'range', paceCounts: [10, 10, 10, 10] })
  })

  test('typed counts of 0 throughout give no date, and a warning on the pace', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '0, 0, 0, 0, 0, 0, 0, 0' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
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
  ] satisfies [InputsEdit, string][])('refuses %j, saying why and changing nothing', async (change, error) => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    const before = await view(team)

    expect(await edit(team, change)).toEqual({ ok: false, error })

    expect(await view(team)).toEqual(before)
    expect((await inputsScreenView(team)).milestone.paceCounts).toEqual([6, 4, 9])
  })

  test.each([
    { kind: 'setPaceCounts', counts: '6, 4' },
    { kind: 'addPaceCount', count: '6' },
    { kind: 'removeLastPaceCount' },
    { kind: 'setPaceMode', paceMode: 'counts' },
  ] satisfies InputsEdit[])('%j needs the milestone first', async (change) => {
    const team = await newTeam()

    expect(await edit(team, change)).toEqual({ ok: false, error: 'Enter the milestone first.' })

    expect(await view(team)).toEqual({ kind: 'empty' })
  })

  test('with no typed counts at a 14-day cadence, the note counts sprints', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      kind: 'problems',
      problems: [{ message: 'Typed counts: 0 sprints entered. The forecast needs at least 4. Add another count, or switch pace to the range.' }],
    })
  })
})
