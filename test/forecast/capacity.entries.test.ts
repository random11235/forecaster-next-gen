import { describe, expect, test } from 'vitest'
import type { Storage } from '../../src/storage/storage.js'
import { TODAY, MONDAY, openStorage, tenTicketsAtFive, submit, add, view, headline } from './capacityScenario.js'

// Capacity (#153, #164, #168): its switch, the week-by-week chart, refused entries, editing an entry, and past entries.
// Arranged through capacityScenario.ts.

describe('the switch', () => {
  test('capacity is on until switched off', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    const forecast = view(storage)

    expect(forecast.kind === 'forecast' && forecast.capacity.on).toBe(true)
  })

  test('switched off, the forecast is as it is without capacity, the entries are kept, and the forecast screen comes next', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    const before = view(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    expect(submit(storage, { kind: 'switchCapacity', on: false })).toEqual({ saved: true, next: 'forecast' })

    const forecast = view(storage)
    expect(headline(storage)).toBe('2026-09-21')
    expect(forecast.kind === 'forecast' && forecast.dates).toEqual(before.kind === 'forecast' && before.dates)
    expect(forecast.kind === 'forecast' && forecast.finishGraph).toEqual(before.kind === 'forecast' && before.finishGraph)
    expect(forecast.kind === 'forecast' && forecast.comparison).toBeUndefined()
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBe('Capacity is switched off for this forecast; its entries are kept.')
    expect(forecast.kind === 'forecast' && forecast.capacity).toMatchObject({
      on: false,
      summary: 'off · 1 entry',
      entries: [{ id: 1, from: '2026-09-07', to: '2026-09-11', percent: 0, note: 'Offsite' }],
    })
  })

  test('switched on again, capacity counts as before', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11')
    const before = view(storage)
    submit(storage, { kind: 'switchCapacity', on: false })

    expect(submit(storage, { kind: 'switchCapacity', on: true })).toEqual({ saved: true, next: 'forecast' })

    expect(view(storage)).toEqual(before)
    expect(headline(storage)).toBe('2026-09-28')
  })

  test('switched off with no capacity touching the forecast, there is no line under the headline', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    submit(storage, { kind: 'switchCapacity', on: false })

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBeUndefined()
    expect(forecast.kind === 'forecast' && forecast.capacity.summary).toBe('none, every week usual')
  })
})

describe('the week-by-week chart', () => {
  test('each bar carries the capacity of the week it ends: a holiday Monday leaves its week at 80%, usual weeks at 100%', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '0', '2026-09-07', '', { note: 'Holiday' })

    const forecast = view(storage)
    // the first bar is the start date itself, before any week has run
    expect(forecast.kind === 'forecast' && forecast.finishGraph.map(({ date, capacity }) => ({ date, capacity }))).toEqual([
      { date: '2026-09-07', capacity: 100 },
      { date: '2026-09-14', capacity: 80 },
      { date: '2026-09-21', capacity: 100 },
      { date: '2026-09-28', capacity: 100 },
    ])
  })

  test('a sprint cadence gives each bar its sprint’s capacity', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage, { cadenceDays: '14', pace: '5' })

    // 3 of the first sprint’s 10 working days at 0%
    add(storage, '0', '2026-09-07', '2026-09-09')

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.finishGraph.map(({ capacity }) => capacity)).toEqual([100, 70, 100, 100])
  })
})

describe('a refused capacity entry', () => {
  test.each([
    ['no start date', { percent: '50', from: '', to: '' }, 'Pick the date it starts.'],
    ['an end that is no date', { percent: '50', from: MONDAY, to: '31/09' }, 'Pick the date it ends, or choose onward.'],
    ['an end before the start', { percent: '50', from: MONDAY, to: '2026-09-01' }, 'The end date is before the start.'],
    ['no percentage', { percent: '', from: MONDAY, to: '' }, 'Capacity is a whole percentage, 0 or more.'],
    ['a fraction', { percent: '50.5', from: MONDAY, to: '' }, 'Capacity is a whole percentage, 0 or more.'],
    ['a negative', { percent: '-10', from: MONDAY, to: '' }, 'Capacity is a whole percentage, 0 or more.'],
    ['above 1000%', { percent: '5000', from: MONDAY, to: '' }, 'Capacity above 1000% can’t be forecast. For a team that much bigger, use a pace range.'],
  ])('%s changes nothing and shows the forecast screen again, as typed, saying why', (_, typed, refusal) => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    const before = view(storage)

    const result = add(storage, typed.percent, typed.from, typed.to, { note: 'Leave' })

    expect(result.saved).toBe(false)
    expect(!result.saved && result.screen).toBe('forecast')
    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity).toEqual({
      on: true,
      open: true,
      summary: 'none, every week usual',
      entries: [],
      past: [],
      form: { ...typed, onward: false, note: 'Leave' },
      refusal,
    })
    expect(view(storage)).toEqual(before)
  })

  test('overlapping entries that multiply past 1000% are refused', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '400', MONDAY, '', { onward: true })

    const result = add(storage, '400', '2026-10-01', '2026-10-09')

    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity.refusal).toBe(
      'Capacity above 1000% can’t be forecast. For a team that much bigger, use a pace range. Here it overlaps other entries, which multiply.',
    )
  })

  test('an Inputs refusal still names the Inputs screen', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    const result = submit(storage, { kind: 'setCadence', cadenceDays: 'weekly' })

    expect(!result.saved && result.screen).toBe('inputs')
  })
})

// Editing entries, and Past (#168)
describe('editing an entry', () => {
  /** The EM edits entry `id` and saves it: its dates, percentage and note as typed. */
  function edit(storage: Storage, id: string, percent: string, from: string, to: string, { onward = false, note = '' } = {}) {
    return submit(storage, { kind: 'editCapacity', id, percent, from, to, onward, note })
  }

  test('saving new dates, percentage and note changes the forecast, and the forecast screen comes next', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    expect(headline(storage)).toBe('2026-09-28')

    expect(edit(storage, '1', '100', '2026-09-14', '2026-09-18', { note: 'Offsite moved' })).toEqual({ saved: true, next: 'forecast' })

    expect(headline(storage)).toBe('2026-09-21')
    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries).toEqual([
      { id: 1, from: '2026-09-14', to: '2026-09-18', percent: 100, note: 'Offsite moved' },
    ])
  })

  test('an edit is refused as an add is, changing nothing and showing the forecast screen with the edit as typed', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    const before = view(storage)

    const result = edit(storage, '1', '50', '2026-09-11', '2026-09-07', { note: 'Shorter' })

    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity).toEqual({
      on: true,
      open: true,
      summary: '1 entry · 85% date 1 week later',
      entries: [{ id: 1, from: '2026-09-07', to: '2026-09-11', percent: 0, note: 'Offsite' }],
      past: [],
      form: { percent: '', from: '', to: '', onward: false, note: '' },
      editing: {
        id: 1,
        form: { percent: '50', from: '2026-09-11', to: '2026-09-07', onward: false, note: 'Shorter' },
        refusal: 'The end date is before the start.',
      },
    })
    expect(view(storage)).toEqual(before)
  })

  test('raising an entry does not count its old self as an overlap', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '400', MONDAY, '', { onward: true })

    expect(edit(storage, '1', '1000', MONDAY, '', { onward: true }).saved).toBe(true)
  })
})

describe('past entries', () => {
  /** A Monday before today: the forecast runs from then. */
  const AUGUST = '2026-08-03'

  test('an entry that ended before today is listed under Past and does not slow the forecast', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: AUGUST, ticketsRemaining: '10' })
    const before = headline(storage)

    add(storage, '0', AUGUST, '2026-08-07', { note: 'Offsite' })
    add(storage, '60', '2026-10-05', '', { onward: true })

    expect(headline(storage)).toBe(before)
    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.past).toEqual([{ id: 1, from: AUGUST, to: '2026-08-07', percent: 0, note: 'Offsite' }])
    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ id }) => id)).toEqual([2])
  })

  test('with only past entries, capacity is not in use: no comparison, no line under the headline', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: AUGUST, ticketsRemaining: '10' })

    add(storage, '0', AUGUST, '2026-08-07', { note: 'Offsite' })

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.comparison).toBeUndefined()
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBeUndefined()
    expect(forecast.kind === 'forecast' && forecast.capacity.summary).toBe('none, every week usual')
  })

  test('an entry ending today is not past yet', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)

    add(storage, '0', '2026-08-17', TODAY)

    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.past).toEqual([])
  })

  test('only a past entry’s note can be edited: its dates and percentage stay as they were', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', AUGUST, '2026-08-07', { note: 'Offsite' })

    const result = submit(storage, { kind: 'editCapacity', id: '1', percent: '50', from: MONDAY, to: '', onward: true, note: 'Team offsite in Lisbon' })

    expect(result).toEqual({ saved: true, next: 'forecast' })
    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.past).toEqual([
      { id: 1, from: AUGUST, to: '2026-08-07', percent: 0, note: 'Team offsite in Lisbon' },
    ])
  })

  test('a past entry is kept: removing it is refused, and it stays under Past', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', AUGUST, '2026-08-07', { note: 'Offsite' })

    const result = submit(storage, { kind: 'removeCapacity', id: '1' })

    expect(!result.saved && result.screen === 'forecast' && result.view.kind === 'forecast' && result.view.capacity.refusal).toBe(
      'Past entries are kept, so it can’t be removed.',
    )
    const forecast = view(storage)
    expect(forecast.kind === 'forecast' && forecast.capacity.past.map(({ id }) => id)).toEqual([1])
  })

  test('a past entry no longer counts toward the limit on overlapping entries', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '400', AUGUST, '', { onward: true })
    submit(storage, { kind: 'acceptNewUsual', id: '1' })

    // 300% from today would multiply with the 400% to 1200%, but that entry is now past: it ends today as the new usual
    const added = add(storage, '300', TODAY, '', { onward: true })
    const edited = submit(storage, { kind: 'editCapacity', id: '2', percent: '350', from: TODAY, to: '', onward: true, note: '' })

    expect([added, edited]).toEqual([
      { saved: true, next: 'forecast' },
      { saved: true, next: 'forecast' },
    ])
  })
})
