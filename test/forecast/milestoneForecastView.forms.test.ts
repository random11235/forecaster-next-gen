import { describe, expect, test } from 'vitest'
import type { InputsEdit } from '../../src/forecast/inputs.js'
import type { Storage } from '../../src/storage/storage.js'
import { TODAY, openStorage, newTeam, submit, edit, enter, view, inputsScreenView } from './forecastViewScenario.js'

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
  function growth(storage: Storage) {
    return inputsScreenView(storage).growth.ranges
  }

  test('starts at low 1–1.5×, medium 1–2× and high 1.5–3×', () => {
    expect(growth(newTeam())).toEqual({
      low: { low: 1, high: 1.5 },
      medium: { low: 1, high: 2 },
      high: { low: 1.5, high: 3 },
    })
  })

  test('names each level as a label', () => {
    expect(inputsScreenView(newTeam()).growth.names).toEqual({ low: 'Low', medium: 'Medium', high: 'High' })
  })

  test('the EM edits the ranges, and the milestone grows by the medium one: 10 tickets at exactly 5 a week, growing 1×, finish in 2 weeks', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(edit(storage, ranges(typed(' 1 ', '1')))).toEqual({ ok: true })

    expect(growth(storage).medium).toEqual({ low: 1, high: 1 })
    expect(view(storage)).toMatchObject({ dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })) })
  })

  test('the milestone grows by the edited range of its own level: high edited to 1–1×, 10 tickets at exactly 5 a week finish in 2 weeks', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    expect(edit(storage, { kind: 'setAmbiguity', level: 'high' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setAmbiguityRanges', low: typed('1', '1.5'), medium: typed('1', '2'), high: typed('1', '1') })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      ambiguity: { level: 'high', low: 1, high: 1 },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
    })
  })

  test('edited ranges are kept across a restart', () => {
    const storage = newTeam()
    expect(edit(storage, { kind: 'setAmbiguityRanges', low: typed('1', '1.2'), medium: typed('1.1', '2.5'), high: typed('2', '4') })).toEqual({ ok: true })

    const reopened = openStorage()

    expect(growth(reopened)).toEqual({
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
  ])('refuses a medium range typed %o, saying why and saving nothing', (medium, error) => {
    const storage = newTeam()

    expect(edit(storage, ranges(medium))).toEqual({ ok: false, error })

    expect(growth(storage).medium).toEqual({ low: 1, high: 2 })
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
  ] satisfies [InputsEdit, string][])('%j, once saved, goes to the %s screen', (change, next) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(submit(storage, change)).toEqual({ saved: true, next })
  })

  test('before any is submitted, the Inputs screen shows each form as saved, and no refusal', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6 4,9' })).toEqual({ ok: true })

    const screen = inputsScreenView(storage)

    expect(screen.forms).toEqual({
      milestone: { name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' },
      cadence: { cadenceDays: '7' },
      paceRange: { low: '4', high: '8' },
      paceCounts: { counts: '6, 4, 9', count: '' },
      growth: { low: typed('1', '1.5'), medium: typed('1', '2'), high: typed('1.5', '3') },
    })
    expect(screen.refusal).toBeUndefined()
  })

  test('before anything is entered, the milestone form has today as its start date and the pace range is blank', () => {
    expect(inputsScreenView(newTeam()).forms).toMatchObject({
      milestone: { name: '', startDate: TODAY, ticketsRemaining: '' },
      paceRange: { low: '', high: '' },
      paceCounts: { counts: '', count: '' },
    })
  })

  test('refused, the milestone form is shown again as typed, beside the saved pace, saying why on the milestone form', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    const submitted = submit(storage, { kind: 'setMilestone', name: 'Checkout v3', startDate: '2026-09-08', ticketsRemaining: '2.5' })

    expect(submitted).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        milestone: { name: 'Checkout v2', ticketsRemaining: 10 },
        forms: {
          milestone: { name: 'Checkout v3', startDate: '2026-09-08', ticketsRemaining: '2.5' },
          paceRange: { low: '4', high: '8' },
        },
        refusal: { form: 'milestone', error: 'Enter tickets remaining as a whole number, 0 or more.' },
      },
    })
  })

  test('refused, a list of typed counts is shown again as typed, saying why on the typed counts', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })

    expect(submit(storage, { kind: 'setPaceCounts', counts: '6, x' })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        forms: { paceCounts: { counts: '6, x', count: '' } },
        refusal: { form: 'paceCounts', error: 'Enter typed counts as whole numbers of tickets, 0 or more.' },
      },
    })
  })

  test('refused, a count to add is shown again as typed after the saved counts', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9' })).toEqual({ ok: true })

    expect(submit(storage, { kind: 'addPaceCount', count: '1001' })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        forms: { paceCounts: { counts: '6, 4, 9', count: '1001' } },
        refusal: { form: 'paceCounts', error: 'Enter at most 1000 tickets per week.' },
      },
    })
  })

  test('refused, removing the last count before the milestone is entered says why on the typed counts', () => {
    expect(submit(newTeam(), { kind: 'removeLastPaceCount' })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: { forms: { paceCounts: { counts: '', count: '' } }, refusal: { form: 'paceCounts', error: 'Enter the milestone first.' } },
    })
  })

  test.each([
    [{ kind: 'setPaceMode', paceMode: 'measured' }, 'paceMode', 'Choose the range or typed counts.'],
    [{ kind: 'setAmbiguity', level: 'extreme' }, 'ambiguity', 'Choose low, medium or high ambiguity.'],
  ] satisfies [InputsEdit, string, string][])('refused, %j shows the saved choice again, saying why on the %s form', (change, form, error) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(submit(storage, change)).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: { milestone: { paceMode: 'range', ambiguity: 'medium' }, refusal: { form, error } },
    })
  })

  test('refused, the cadence and the pace range are each shown again as typed', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(submit(storage, { kind: 'setCadence', cadenceDays: '0' })).toMatchObject({
      screen: 'inputs',
      view: { forms: { cadence: { cadenceDays: '0' }, paceRange: { low: '4', high: '8' } }, refusal: { form: 'cadence' } },
    })
    expect(submit(storage, { kind: 'setPaceRange', low: '8', high: '4' })).toMatchObject({
      screen: 'inputs',
      view: { forms: { cadence: { cadenceDays: '7' }, paceRange: { low: '8', high: '4' } }, refusal: { form: 'paceRange' } },
    })
  })

  test('refused, the ambiguity ranges are shown again as typed', () => {
    const storage = newTeam()

    expect(submit(storage, { ...growth, medium: typed('2', '1.5') })).toMatchObject({
      saved: false,
      screen: 'inputs',
      view: {
        growth: { ranges: { medium: { low: 1, high: 2 } } },
        forms: { growth: { low: typed('1', '1.5'), medium: typed('2', '1.5'), high: typed('1.5', '3') } },
        refusal: { form: 'growth', error: 'Medium ambiguity: the low end must not be above the high end.' },
      },
    })
  })
})
