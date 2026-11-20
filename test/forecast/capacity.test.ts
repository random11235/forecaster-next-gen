import { describe, expect, test } from 'vitest'
import { submitInputs } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { Storage } from '../../src/storage/storage.js'
import { TEAM, TODAY, MONDAY, openStorage, tenTicketsAtFive, submit, add, view, headline, withoutCapacity } from './capacityScenario.js'

// Capacity (#153, #164): the EM types the team's capacity beside the forecast, and each period's pace is scaled by it.
// Arranged through capacityScenario.ts.

describe('typing capacity', () => {
  test('a week at 0% finishes nothing that week, so the headline moves a week later, and the forecast screen comes next', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    expect(headline(storage)).toBe('2026-09-21')

    expect(add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })).toEqual({ saved: true, next: 'forecast' })

    expect(headline(storage)).toBe('2026-09-28')
  })

  test('a holiday Monday leaves the week at 80%, as weekends do not count', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '0', '2026-09-07', '', { note: 'Holiday' })

    // 4 that week, then 5 and 5: done in the third
    expect(headline(storage)).toBe('2026-09-28')
  })

  test('a day off at the weekend changes nothing', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '0', '2026-09-12', '2026-09-13')

    expect(headline(storage)).toBe('2026-09-21')
  })

  test('a sprint cadence averages capacity over the sprint’s ten working days', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage, { cadenceDays: '14' })
    expect(headline(storage)).toBe('2026-10-05')

    // half the first sprint off: 2.5 that sprint, so a third sprint is needed
    add(storage, '0', '2026-09-07', '2026-09-11')

    expect(headline(storage)).toBe('2026-10-19')
  })

  test('overlapping entries multiply: 50% of 50% is a quarter of the usual pace', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '50', MONDAY, '', { onward: true, note: 'KTLO' })
    add(storage, '50', MONDAY, '', { onward: true, note: 'Half on leave' })

    // 1.25 a week: done in the eighth week
    expect(headline(storage)).toBe('2026-11-02')
  })

  test('capacity before the start date does not touch the forecast', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    const before = view(storage)

    add(storage, '0', '2026-08-24', '2026-09-04')

    expect(withoutCapacity(view(storage))).toEqual(withoutCapacity(before))
  })

  test('the past counts typed for the pace are not adjusted for capacity', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    submit(storage, { kind: 'setPaceCounts', counts: '5 5 5 5 5 5' })
    submit(storage, { kind: 'setPaceMode', paceMode: 'counts' })
    expect(headline(storage)).toBe('2026-09-21')

    // a week in the past at 0% doesn't make those counts mean a faster team
    add(storage, '0', '2026-08-03', '2026-08-07')

    expect(headline(storage)).toBe('2026-09-21')
  })

  test('with no entries, the section lists none, its form is blank, and the forecast is as it was', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    const forecast = view(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity).toEqual({
      on: true,
      open: false,
      summary: 'none, every week usual',
      entries: [],
      past: [],
      form: { percent: '', from: '', to: '', onward: false, note: '' },
    })
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBeUndefined()
  })

  test('the entries are listed earliest first, an empty end being the one day it starts', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '60', '2026-10-05', '', { onward: true, note: 'Two leave' })
    add(storage, '0', '2026-09-14', '', { note: 'Holiday' })

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries).toEqual([
      { id: 2, from: '2026-09-14', to: '2026-09-14', percent: 0, note: 'Holiday' },
      { id: 1, from: '2026-10-05', to: undefined, percent: 60, note: 'Two leave' },
    ])
  })

  test('removing an entry takes it out of the forecast', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11')

    expect(submit(storage, { kind: 'removeCapacity', id: '1' })).toEqual({ saved: true, next: 'forecast' })

    expect(headline(storage)).toBe('2026-09-21')
    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries).toEqual([])
  })

  test('an entry far above usual is warned of: the pace comes from a much smaller team', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '150', MONDAY, '', { onward: true })
    add(storage, '300', '2026-12-01', '', { onward: true })

    const forecast = view(storage)
    const entries = forecast.kind === 'forecast' ? forecast.capacity.entries : []
    expect(entries.map(({ warning }) => warning)).toEqual([
      undefined,
      'At 300%, the pace comes from a team about 33% this size, so it’s a weak guide. A pace range may be better.',
    ])
  })
})

describe('the comparison', () => {
  test('with capacity in use, each date is given with capacity and at usual capacity, and the shift in periods between them', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.comparison).toEqual([
      { percent: 50, withCapacity: '2026-09-28', atUsual: '2026-09-21', shift: 1 },
      { percent: 85, withCapacity: '2026-09-28', atUsual: '2026-09-21', shift: 1 },
      { percent: 95, withCapacity: '2026-09-28', atUsual: '2026-09-21', shift: 1 },
    ])
  })

  test('both forecasts use the same draws, so capacity after every trial has finished leaves each date where it was', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    submit(storage, { kind: 'setPaceRange', low: '2', high: '9' })

    add(storage, '120', '2027-06-01', '', { onward: true })

    const forecast = view(storage)
    const comparison = forecast.kind === 'forecast' ? forecast.comparison : undefined
    expect(comparison?.map(({ shift }) => shift)).toEqual([0, 0, 0])
    expect(comparison?.map(({ withCapacity }) => withCapacity)).toEqual(comparison?.map(({ atUsual }) => atUsual))
  })

  test.each([
    ['later', '0', MONDAY, '2026-09-11', 'Includes capacity, which moves the 85% date 1 week later.', '1 entry · 85% date 1 week later'],
    ['sooner', '200', MONDAY, '', 'Includes capacity, which moves the 85% date 1 week sooner.', '1 entry · 85% date 1 week sooner'],
    ['not at all', '120', '2027-06-01', '', 'Includes capacity, which doesn’t move the 85% date.', '1 entry'],
  ])('capacity moving the 85%% date %s says so under the headline and in the folded summary', (_, percent, from, to, line, summary) => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, percent, from, to, { onward: to === '' })

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBe(line)
    expect(forecast.kind === 'forecast' && forecast.capacity.summary).toBe(summary)
  })

  test('the shift is in the team’s periods: a sprint later', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage, { cadenceDays: '14' })

    add(storage, '0', '2026-09-07', '2026-09-11')
    add(storage, '0', '2026-09-21', '2026-09-25')

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBe('Includes capacity, which moves the 85% date 1 sprint later.')
    expect(forecast.kind === 'forecast' && forecast.capacity.summary).toBe('2 entries · 85% date 1 sprint later')
  })

  test('with no capacity in use there is nothing to compare', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    const forecast = view(storage)

    expect(forecast.kind === 'forecast' && forecast.comparison).toBeUndefined()
  })
})

describe('each entry’s effect', () => {
  /** The forecast with the Capacity section open, as the EM sees it beside the entries. */
  function opened(storage: Storage) {
    return milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { capacityOpen: true })
  }

  test('with the section open, each entry gives its own shift of the 85% date, from a run without it on the same draws', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    add(storage, '120', '2027-06-01', '', { onward: true })

    const forecast = opened(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity.open).toBe(true)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ note, effect }) => [note, effect])).toEqual([
      ['Offsite', { shift: 1, words: '85% date +1 wk' }],
      ['', { shift: 0, words: 'no change to the 85% date' }],
    ])
  })

  test('an entry that brings the 85% date sooner says so, in the team’s periods', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage, { cadenceDays: '14' })
    add(storage, '200', MONDAY, '', { onward: true })

    const forecast = opened(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries[0]?.effect).toEqual({ shift: -1, words: '85% date −1 sprint' })
  })

  test('an entry beyond the horizon, the only one, gives no change to the 85% date', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '50', '2031-01-06', '2031-01-10', { note: 'Far off' })

    const forecast = opened(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries[0]?.effect).toEqual({ shift: 0, words: 'no change to the 85% date' })
  })

  test('with the section folded, no entry gives its effect', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const forecast = view(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity.open).toBe(false)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ effect }) => effect)).toEqual([undefined])
  })

  test('switched off, the section open, no entry gives its effect', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    submit(storage, { kind: 'switchCapacity', on: false })

    const forecast = opened(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ effect }) => effect)).toEqual([undefined])
  })

  test('opening the section changes nothing else on the screen', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    expect(withoutCapacity(opened(storage))).toEqual(withoutCapacity(view(storage)))
  })

  test('a refused entry shows the section open, with each entry’s effect when it was open', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const result = submitInputs(
      storage,
      TEAM,
      DEFAULT_SETTINGS,
      TODAY,
      { kind: 'addCapacity', percent: 'half', from: MONDAY, to: '', onward: false, note: '' },
      { capacityOpen: true },
    )

    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity.open).toBe(true)
    expect(shown?.kind === 'forecast' && shown.capacity.entries[0]?.effect).toEqual({ shift: 1, words: '85% date +1 wk' })
  })
})

describe('a refusal from the folded section', () => {
  test('shows the section open to say why, without working out the effects', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const result = add(storage, 'half', MONDAY, '')

    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity.open).toBe(true)
    expect(shown?.kind === 'forecast' && shown.capacity.entries[0]?.effect).toBeUndefined()
  })
})
