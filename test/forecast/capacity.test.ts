import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// Capacity (#153, #164): the EM types the team's capacity beside the forecast, and each period's pace is scaled by it.

const TEAM = 'ACME'
const TODAY = '2026-08-24'
/** A Monday, so each week from it runs Monday to Sunday. */
const MONDAY = '2026-09-07'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-capacity-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

function openStorage(): Storage {
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

/** 10 tickets at exactly 5 a week, growing 1×, from Monday 7 Sep: with usual capacity, done on 21 Sep. */
function tenTicketsAtFive(storage: Storage, { cadenceDays = '7', pace = '5' } = {}): void {
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1 }, medium: { low: 1, high: 1 }, high: { low: 1, high: 1 } })
  submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: MONDAY, ticketsRemaining: '10' })
  submit(storage, { kind: 'setCadence', cadenceDays })
  submit(storage, { kind: 'setPaceRange', low: pace, high: pace })
}

function submit(storage: Storage, edit: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit)
}

/** The EM types capacity as one sentence: "The team is at {percent}% from {from} to {to}, or onward, for {note}." */
function add(storage: Storage, percent: string, from: string, to: string, { onward = false, note = '' } = {}) {
  return submit(storage, { kind: 'addCapacity', percent, from, to, onward, note })
}

function view(storage: Storage) {
  return milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)
}

/** The 85% date the headline gives. */
function headline(storage: Storage): string | null | undefined {
  const forecast = view(storage)
  return forecast.kind === 'forecast' ? forecast.dates.find(({ percent }) => percent === 85)?.date : undefined
}

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
      entries: [],
      past: [],
      form: { percent: '', from: '', to: '', onward: false, note: '' },
    })
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
    [
      'above 1000%',
      { percent: '5000', from: MONDAY, to: '' },
      'Capacity above 1000% can’t be forecast. For a team that much bigger, use a pace range.',
    ],
  ])('%s changes nothing and shows the forecast screen again, as typed, saying why', (_, typed, refusal) => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    const before = view(storage)

    const result = add(storage, typed.percent, typed.from, typed.to, { note: 'Leave' })

    expect(result.saved).toBe(false)
    expect(!result.saved && result.screen).toBe('forecast')
    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity).toEqual({
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

function withoutCapacity(forecast: ReturnType<typeof view>) {
  if (forecast.kind !== 'forecast') return forecast
  const { capacity: _, ...rest } = forecast
  return rest
}

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
    expect(forecast.kind === 'forecast' && forecast.capacity.entries).toEqual([{ id: 1, from: '2026-09-14', to: '2026-09-18', percent: 100, note: 'Offsite moved' }])
  })

  test('an edit is refused as an add is, changing nothing and showing the forecast screen with the edit as typed', () => {
    const storage = openStorage()
    tenTicketsAtFive(storage)
    add(storage, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    const before = view(storage)

    const result = edit(storage, '1', '50', '2026-09-11', '2026-09-07', { note: 'Shorter' })

    const shown = !result.saved && result.screen === 'forecast' ? result.view : undefined
    expect(shown?.kind === 'forecast' && shown.capacity).toEqual({
      entries: [{ id: 1, from: '2026-09-07', to: '2026-09-11', percent: 0, note: 'Offsite' }],
      past: [],
      form: { percent: '', from: '', to: '', onward: false, note: '' },
      editing: { id: 1, form: { percent: '50', from: '2026-09-11', to: '2026-09-07', onward: false, note: 'Shorter' }, refusal: 'The end date is before the start.' },
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
    expect(forecast.kind === 'forecast' && forecast.capacity.past).toEqual([{ id: 1, from: AUGUST, to: '2026-08-07', percent: 0, note: 'Team offsite in Lisbon' }])
  })
})
