import { describe, expect, test } from 'vitest'
import type { InputsEdit } from '../../src/forecast/index.js'
import type { ForecastingForTest } from './forecastingForTest.js'
import { TODAY, newTeam, submit, edit, enter, view, inputsScreenView } from './forecastViewScenario.js'

// Seam B: growth on the Inputs screen, and where each submitted form leads. Arranged through forecastViewScenario.ts.

describe('growth on the Inputs screen', () => {
  const typed = (low: string, high: string) => ({ low, high })
  /** The ambiguity ranges as typed: the defaults for low and high, and `medium`. */
  const ranges = (medium: { low: string; high: string }): InputsEdit => ({
    kind: 'setAmbiguityRanges',
    low: typed('1', '1.5'),
    medium,
    high: typed('1.5', '3'),
  })
  async function growth(team: ForecastingForTest) {
    return (await inputsScreenView(team)).growth.ranges
  }

  test('starts at low 1–1.5×, medium 1–2× and high 1.5–3×', async () => {
    expect(await growth(await newTeam())).toEqual({
      low: { low: 1, high: 1.5 },
      medium: { low: 1, high: 2 },
      high: { low: 1.5, high: 3 },
    })
  })

  test('names each level as a label', async () => {
    expect((await inputsScreenView(await newTeam())).growth.names).toEqual({ low: 'Low', medium: 'Medium', high: 'High' })
  })

  test('the EM edits the ranges, and the milestone grows by the medium one: 10 tickets at exactly 5 a week, growing 1×, finish in 2 weeks', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(await edit(team, ranges(typed(' 1 ', '1')))).toEqual({ ok: true })

    expect((await growth(team)).medium).toEqual({ low: 1, high: 1 })
    expect(await view(team)).toMatchObject({ dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })) })
  })

  test('the milestone grows by the edited range of its own level: high edited to 1–1×, 10 tickets at exactly 5 a week finish in 2 weeks', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    expect(await edit(team, { kind: 'setAmbiguity', level: 'high' })).toEqual({ ok: true })

    expect(await edit(team, { kind: 'setAmbiguityRanges', low: typed('1', '1.5'), medium: typed('1', '2'), high: typed('1', '1') })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({
      ambiguity: { level: 'high', low: 1, high: 1 },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
    })
  })

  test('edited ranges are kept across a restart', async () => {
    const team = await newTeam()
    expect(await edit(team, { kind: 'setAmbiguityRanges', low: typed('1', '1.2'), medium: typed('1.1', '2.5'), high: typed('2', '4') })).toEqual({ ok: true })

    team.restart()

    expect(await growth(team)).toEqual({
      low: { low: 1, high: 1.2 },
      medium: { low: 1.1, high: 2.5 },
      high: { low: 2, high: 4 },
    })
  })

  test.each([
    [typed('', '2'), 'Medium ambiguity: enter the range as two numbers, such as 1 to 1.5.'],
    [typed('one', '2'), 'Medium ambiguity: enter the range as two numbers, such as 1 to 1.5.'],
    [typed('0', '2'), 'Medium ambiguity: enter growth above 0 and at most 10 times.'],
    [typed('-1', '2'), 'Medium ambiguity: enter growth above 0 and at most 10 times.'],
    [typed('1', '11'), 'Medium ambiguity: enter growth above 0 and at most 10 times.'],
    [typed('2', '1.5'), 'Medium ambiguity: the low end must not be above the high end.'],
  ])('refuses a medium range typed %o, saying why and saving nothing', async (medium, error) => {
    const team = await newTeam()

    expect(await edit(team, ranges(medium))).toEqual({ ok: false, error })

    expect((await growth(team)).medium).toEqual({ low: 1, high: 2 })
  })
})

describe('a submitted form', () => {
  const typed = (low: string, high: string) => ({ low, high })
  const growth = { kind: 'setAmbiguityRanges', low: typed('1', '1.5'), medium: typed('1', '2'), high: typed('1.5', '3') } as const

  test.each([
    [{ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' }, 'inputs'],
    [{ kind: 'setCadence', cadenceDays: '14' }, 'inputs'],
    [{ kind: 'setPaceRange', low: '4', high: '8' }, 'forecast'],
    [{ kind: 'setPaceMode', paceMode: 'counts' }, 'forecast'],
    [{ kind: 'setPaceCounts', counts: '6, 4' }, 'inputs'],
    [{ kind: 'addPaceCount', count: '6' }, 'inputs'],
    [{ kind: 'removeLastPaceCount' }, 'inputs'],
    [{ kind: 'setAmbiguity', level: 'high' }, 'forecast'],
    [growth, 'inputs'],
  ] satisfies [InputsEdit, string][])('%j, once saved, goes to the %s screen', async (change, next) => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(await submit(team, change)).toEqual({ saved: true, next: { screen: next } })
  })

  test('before any is submitted, the Inputs screen shows each form as saved, and no refusal', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6 4,9' })).toEqual({ ok: true })

    const screen = await inputsScreenView(team)

    expect(screen.forms).toEqual({
      milestone: { name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' },
      cadence: { cadenceDays: '7' },
      paceRange: { low: '4', high: '8' },
      paceCounts: { counts: '6, 4, 9', count: '' },
      growth: { low: typed('1', '1.5'), medium: typed('1', '2'), high: typed('1.5', '3') },
    })
    expect(screen.refusal).toBeUndefined()
  })

  test('before anything is entered, the milestone form has today as its start date and the pace range is blank', async () => {
    expect((await inputsScreenView(await newTeam())).forms).toMatchObject({
      milestone: { name: '', startDate: TODAY, ticketsRemaining: '' },
      paceRange: { low: '', high: '' },
      paceCounts: { counts: '', count: '' },
    })
  })

  test('refused, the milestone form is shown again as typed, beside the saved pace, saying why on the milestone form', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    const submitted = await submit(team, { kind: 'setMilestone', name: 'Checkout v3', startDate: '2026-09-08', ticketsRemaining: '2.5' })

    expect(submitted).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        inputs: {
          milestone: { name: 'Checkout v2', ticketsRemaining: 10 },
          forms: {
            milestone: { name: 'Checkout v3', startDate: '2026-09-08', ticketsRemaining: '2.5' },
            paceRange: { low: '4', high: '8' },
          },
          refusal: { form: 'milestone', error: 'Enter tickets remaining as a whole number, 0 or more.' },
        },
      },
    })
  })

  test('refused, a list of typed counts is shown again as typed, saying why on the typed counts', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })

    expect(await submit(team, { kind: 'setPaceCounts', counts: '6, x' })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        inputs: {
          forms: { paceCounts: { counts: '6, x', count: '' } },
          refusal: { form: 'paceCounts', error: 'Enter typed counts as whole numbers of tickets, 0 or more.' },
        },
      },
    })
  })

  test('refused, a count to add is shown again as typed after the saved counts', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })

    expect(await submit(team, { kind: 'addPaceCount', count: '1001' })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        inputs: {
          forms: { paceCounts: { counts: '6, 4, 9', count: '1001' } },
          refusal: { form: 'paceCounts', error: 'Enter at most 1000 tickets per week.' },
        },
      },
    })
  })

  test('refused, removing the last count before the milestone is entered says why on the typed counts', async () => {
    expect(await submit(await newTeam(), { kind: 'removeLastPaceCount' })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: { inputs: { forms: { paceCounts: { counts: '', count: '' } }, refusal: { form: 'paceCounts', error: 'Enter the milestone first.' } } },
    })
  })

  test.each([
    [{ kind: 'setPaceMode', paceMode: 'measured' }, 'paceMode', 'Choose the range or typed counts.'],
    [{ kind: 'setAmbiguity', level: 'extreme' }, 'ambiguity', 'Choose low, medium or high ambiguity.'],
  ] satisfies [InputsEdit, string, string][])('refused, %j shows the saved choice again, saying why on the %s form', async (change, form, error) => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(await submit(team, change)).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: { inputs: { milestone: { paceMode: 'range', ambiguity: 'medium' }, refusal: { form, error } } },
    })
  })

  test('refused, the cadence and the pace range are each shown again as typed', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(await submit(team, { kind: 'setCadence', cadenceDays: '0' })).toMatchObject({
      screen: 'inputs',
      view: { inputs: { forms: { cadence: { cadenceDays: '0' }, paceRange: { low: '4', high: '8' } }, refusal: { form: 'cadence' } } },
    })
    expect(await submit(team, { kind: 'setPaceRange', low: '8', high: '4' })).toMatchObject({
      screen: 'inputs',
      view: { inputs: { forms: { cadence: { cadenceDays: '7' }, paceRange: { low: '8', high: '4' } }, refusal: { form: 'paceRange' } } },
    })
  })

  test('refused, the ambiguity ranges are shown again as typed', async () => {
    const team = await newTeam()

    expect(await submit(team, { ...growth, medium: typed('2', '1.5') })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        inputs: {
          growth: { ranges: { medium: { low: 1, high: 2 } } },
          forms: { growth: { low: typed('1', '1.5'), medium: typed('2', '1.5'), high: typed('1.5', '3') } },
          refusal: { form: 'growth', error: 'Medium ambiguity: the low end must not be above the high end.' },
        },
      },
    })
  })
})
