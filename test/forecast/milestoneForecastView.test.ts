import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { inputsView, submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { ENGINE_VERSION, simulateCase } from '../../src/engine/index.js'
import type { GrowthRange } from '../../src/model/ambiguity.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
/** Today, fixed: before every start date these tests enter, unless a test says the start date is past. */
const TODAY = '2026-08-24'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the SQLite file the app would use, in a fresh directory per test. */
function openStorage(): Storage {
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

/** A team with nothing entered yet. */
function newTeam(): Storage {
  const storage = openStorage()
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'jira', sourceRef: TEAM, installedAt: '2026-01-01T00:00:00Z' })
  return storage
}

/** Sets the team's medium growth range: the growth of a milestone of medium ambiguity, the default. */
function mediumGrowth(storage: Storage, medium: GrowthRange): void {
  storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1.5 }, medium, high: { low: 1.5, high: 3 } })
}

function submit(storage: Storage, change: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, change)
}

/** Submits a form on the Inputs screen: saved, or why it was refused there. */
function edit(storage: Storage, change: InputsEdit) {
  const submitted = submit(storage, change)
  if (submitted.saved) return { ok: true }
  return submitted.screen === 'inputs' ? { ok: false, error: submitted.view.refusal.error } : { ok: false, screen: submitted.screen }
}

/** The EM enters the milestone and a pace range, as the Inputs screen does. */
function enter(storage: Storage, milestone: { startDate: string; ticketsRemaining: string }, pace: { low: string; high: string }): void {
  expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', ...milestone })).toEqual({ ok: true })
  expect(edit(storage, { kind: 'setPaceRange', ...pace })).toEqual({ ok: true })
}

/** 100 tickets at 4–8 a week, growing 1–2×, from 1 Sep 2026: the engine's dates for the fixed seed. */
const DATES_FROM_1_SEP = [
  { percent: 50, date: '2027-03-02' },
  { percent: 70, date: '2027-03-23' },
  { percent: 85, date: '2027-04-06' },
  { percent: 95, date: '2027-04-20' },
]

/** The same forecast started two weeks later: every date two weeks later. */
const DATES_FROM_15_SEP = [
  { percent: 50, date: '2027-03-16' },
  { percent: 70, date: '2027-04-06' },
  { percent: 85, date: '2027-04-20' },
  { percent: 95, date: '2027-05-04' },
]

function view(storage: Storage, settings = DEFAULT_SETTINGS) {
  return milestoneForecastView(storage, TEAM, settings, TODAY)
}

function inputsScreenView(storage: Storage, settings = DEFAULT_SETTINGS) {
  return inputsView(storage, TEAM, settings, TODAY)
}

describe('the forecast from what the EM enters', () => {
  test('starts on the start date: 10 tickets at exactly 5 a week, with no growth, finish 2 weeks after it', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(view(storage)).toEqual({
      kind: 'forecast',
      name: 'Checkout v2',
      ticketsRemaining: 10,
      startDate: '2026-09-01',
      headlinePercent: 85,
      dates: [
        { percent: 50, date: '2026-09-15', alreadyPast: false },
        { percent: 70, date: '2026-09-15', alreadyPast: false },
        { percent: 85, date: '2026-09-15', alreadyPast: false },
        { percent: 95, date: '2026-09-15', alreadyPast: false },
      ],
      horizonDate: '2029-08-28',
      cadenceDays: 7,
      pace: { source: 'range', low: 5, high: 5 },
      ambiguity: { level: 'medium', low: 1, high: 1 },
      warnings: [],
      finishGraph: [
        { date: '2026-09-01', share: 0, finishedBy: 0 },
        { date: '2026-09-08', share: 0, finishedBy: 0 },
        { date: '2026-09-15', share: 1, finishedBy: 1 },
      ],
      paceTrend: undefined,
      capacity: { entries: [], past: [], form: { percent: '', from: '', to: '', onward: false, note: '' } },
    })
  })

  test('100 tickets at 4–8 a week, growing by the default medium range, from the fixed seed', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toMatchObject({
      kind: 'forecast',
      dates: DATES_FROM_1_SEP,
      pace: { source: 'range', low: 4, high: 8 },
    })
  })

  test('moving the start date moves every date by the same gap', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-15', ticketsRemaining: '100' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ startDate: '2026-09-15', dates: DATES_FROM_15_SEP })
  })

  test('the same inputs always give the same forecast', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toEqual(view(storage))
  })

  test('300 tickets at 1.5 a week take 200 weeks: every confidence level is beyond the 156-week horizon, so has no date, and the horizon date is given to show "later than"', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '300' }, { low: '0', high: '3' })

    expect(view(storage)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null })),
      horizonDate: '2029-08-28',
    })
  })

  test('zero pace gives no date at all, and a warning on the pace', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(view(storage)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null })),
      warnings: [{ input: 'pace', message: 'At 0 tickets a week, the work never finishes.' }],
    })
  })

  test('0 tickets remaining finishes on the start date', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '0' }, { low: '0', high: '0' })

    expect(view(storage)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-01' })),
      warnings: [],
    })
  })

  test('inputs are kept across a restart', () => {
    enter(newTeam(), { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(openStorage())).toMatchObject({ name: 'Checkout v2', startDate: '2026-09-01', dates: DATES_FROM_1_SEP })
  })
})

describe('the finish graph', () => {
  function graph(storage: Storage) {
    const forecast = view(storage)
    if (forecast.kind !== 'forecast') throw new Error(`no forecast: ${forecast.kind}`)
    return forecast
  }
  const sum = (shares: number[]) => shares.reduce((total, share) => total + share, 0)

  test('has a bar for each week from the start date to the last finish, each finished-by share the running sum of the shares, ending with every trial finished', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { finishGraph } = graph(storage)

    expect(finishGraph[0]!.date).toBe('2026-09-01')
    expect(finishGraph[1]!.date).toBe('2026-09-08')
    finishGraph.forEach(({ finishedBy }, i) => expect(finishedBy).toBeCloseTo(sum(finishGraph.slice(0, i + 1).map((bar) => bar.share)), 9))
    expect(finishGraph.at(-1)!.finishedBy).toBe(1)
    expect(finishGraph.at(-1)!.share).toBeGreaterThan(0)
  })

  test('each bar is the share of trials finishing that week, so the slowest week holds a few trials, not a whole percent', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { finishGraph } = graph(storage)
    const firstFinish = finishGraph.findIndex(({ share }) => share > 0)

    expect(finishGraph.at(-1)!.share).toBeLessThan(0.01)
    expect(finishGraph.slice(firstFinish).every(({ share }) => share > 0)).toBe(true)
  })

  test('each confidence date falls on the first bar by which that share of trials has finished', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { finishGraph, dates } = graph(storage)

    for (const { percent, date } of dates) {
      expect(finishGraph.find(({ finishedBy }) => finishedBy >= percent / 100)!.date).toBe(date)
    }
  })

  test('when some trials run past the horizon, the bars stop at the last finish within it and their shares sum to the share that finished', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })

    // 150 tickets at 0–2 a week, 1 on average: about 150 weeks, close to the 156-week horizon
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '150' }, { low: '0', high: '2' })

    const { finishGraph, dates, horizonDate } = graph(storage)
    const finished = finishGraph.at(-1)!.finishedBy

    expect(dates.find(({ percent }) => percent === 85)!.date).toBeNull()
    expect(finished).toBeGreaterThan(0.5)
    expect(finished).toBeLessThan(0.85)
    expect(sum(finishGraph.map((bar) => bar.share))).toBeCloseTo(finished, 9)
    expect(finishGraph.at(-1)!.date <= horizonDate).toBe(true)
  })

  test('0 tickets remaining: one bar, on the start date, holding every trial', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '0' }, { low: '4', high: '8' })

    expect(graph(storage).finishGraph).toEqual([{ date: '2026-09-01', share: 1, finishedBy: 1 }])
  })

  test('zero pace: no trial finishes, so there are no bars', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(graph(storage).finishGraph).toEqual([])
  })

  test('at a 14-day cadence, a bar per sprint: 10 tickets at exactly 5 a sprint, with no growth, all finish in the second sprint', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect(graph(storage).finishGraph).toEqual([
      { date: '2026-09-01', share: 0, finishedBy: 0 },
      { date: '2026-09-15', share: 0, finishedBy: 0 },
      { date: '2026-09-29', share: 1, finishedBy: 1 },
    ])
  })
})

describe('a start date in the past', () => {
  test('is stated as such, with the exact number of days before today, naming the start date', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-05-24', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toMatchObject({
      warnings: [{ input: 'startDate', message: "Start date is 92 days before today; tickets remaining are still today's count." }],
    })
  })

  test.each(['2026-08-24', '2026-08-25'])('a start date of today or later, %s, has no note', (startDate) => {
    const storage = newTeam()

    enter(storage, { startDate, ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toMatchObject({ warnings: [] })
  })

  test('a start date the day before today says 1 day', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-08-23', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toMatchObject({
      warnings: [{ input: 'startDate', message: "Start date is 1 day before today; tickets remaining are still today's count." }],
    })
  })
})

describe('a start date in the past, on the Inputs screen', () => {
  test('shows the same note beside the start date', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-05-24', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(inputsScreenView(storage).milestone.notes).toEqual([
      { input: 'startDate', message: "Start date is 92 days before today; tickets remaining are still today's count." },
    ])
  })
})

describe('forecast dates before today', () => {
  test('are marked already past, and dates on or after today are not', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })

    // 10 tickets at 1–9 a week from 3 Aug: some trials finish by 17 Aug, a week before today, others on or after it
    enter(storage, { startDate: '2026-08-03', ticketsRemaining: '10' }, { low: '1', high: '9' })

    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, '2026-08-24')).toMatchObject({
      dates: [
        { percent: 50, date: '2026-08-17', alreadyPast: true },
        { percent: 70, date: '2026-08-24', alreadyPast: false },
        { percent: 85, date: '2026-08-24', alreadyPast: false },
        { percent: 95, date: '2026-08-31', alreadyPast: false },
      ],
    })
  })

  test('later than the horizon is never already past', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-05-24', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(view(storage)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null, alreadyPast: false })),
    })
  })
})

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
    expect(forecast).toMatchObject({ cadenceDays: 14, pace: { source: 'range', low: 4, high: 8 } })
    if (forecast.kind !== 'forecast') throw new Error('expected a forecast')
    forecast.dates.forEach(({ date }, index) => expect(date! > DATES_FROM_1_SEP[index]!.date).toBe(true))
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
    expect(view(storage)).toMatchObject({ pace: { source: 'counts', counts: [10, 10, 10, 10] }, dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-08' })) })
    expect(inputsScreenView(storage).milestone).toMatchObject({ paceMode: 'counts', paceRange: { low: 5, high: 5 } })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'range' })).toEqual({ ok: true })
    storage = openStorage()
    expect(view(storage)).toMatchObject({ pace: { source: 'range', low: 5, high: 5 }, dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })) })
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

describe('before there is a forecast', () => {
  test('with nothing entered, the screen is empty', () => {
    expect(view(newTeam())).toEqual({ kind: 'empty' })
  })

  test('a milestone kept from before the MVP lists what to enter, each naming its input', () => {
    const storage = newTeam()
    storage.saveMilestoneInputs({
      teamId: TEAM,
      name: 'Checkout v2',
      startDate: undefined,
      ticketsRemaining: undefined,
      ambiguity: 'medium',
      cadenceDays: 7,
      paceMode: 'range',
      paceRange: undefined,
      paceCounts: [],
      paceCadenceDays: undefined,
    })

    expect(view(storage)).toEqual({
      kind: 'problems',
      name: 'Checkout v2',
      problems: [
        { input: 'startDate', message: 'No start date is saved yet.' },
        { input: 'ticketsRemaining', message: 'Enter how many tickets are left.' },
        { input: 'pace', message: 'Enter a pace range.' },
      ],
    })
  })

  test('a milestone kept from before the MVP, on too few typed counts, lists them with what else to enter', () => {
    const storage = newTeam()
    storage.saveMilestoneInputs({
      teamId: TEAM,
      name: 'Checkout v2',
      startDate: undefined,
      ticketsRemaining: 10,
      ambiguity: 'medium',
      cadenceDays: 7,
      paceMode: 'counts',
      paceRange: undefined,
      paceCounts: [6],
      paceCadenceDays: undefined,
    })

    expect(view(storage)).toEqual({
      kind: 'problems',
      name: 'Checkout v2',
      problems: [
        { input: 'startDate', message: 'No start date is saved yet.' },
        {
          input: 'typedCounts',
          message: 'Typed counts: 1 week entered. The forecast needs at least 4. Add another count, or switch pace to the range.',
        },
      ],
    })
  })

  test('a milestone without a pace yet asks for one', () => {
    const storage = newTeam()

    expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ kind: 'problems', problems: [{ input: 'pace', message: 'Enter a pace range.' }] })
  })
})

describe('the typed counts the settings ask for', () => {
  /** Settings needing 3 typed counts to forecast and 5 to be reliable, not the default 2 and 8. */
  const settings = { ...DEFAULT_SETTINGS, typedCounts: { forForecast: 3, reliable: 5 } }

  /** The milestone forecast from `counts`, typed counts in use. */
  function onCounts(counts: string): Storage {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    return storage
  }

  test('with 2 typed counts, too few for the settings, there is no forecast, and the Inputs screen says so beside the pace', () => {
    const storage = onCounts('6, 4')

    const note = {
      input: 'typedCounts',
      message: 'Typed counts: 2 weeks entered. The forecast needs at least 3. Add another count, or switch pace to the range.',
    }
    expect(view(storage, settings)).toEqual({ kind: 'problems', name: 'Checkout v2', problems: [note] })
    expect(inputsScreenView(storage, settings).milestone.notes).toEqual([note])
  })

  test('with 4 typed counts, the forecast warns it needs 5 to be reliable, and the Inputs screen says so beside the pace', () => {
    const storage = onCounts('6, 4, 9, 7')

    expect(view(storage, settings)).toMatchObject({
      kind: 'forecast',
      warnings: [{ input: 'typedCounts', message: 'Typed counts: 4 weeks entered. The forecast needs 5 to be reliable.' }],
    })
    expect(inputsScreenView(storage, settings).milestone.notes).toEqual([{ input: 'typedCounts', message: '4 of 5 needed for reliable results' }])
  })

  test('with 5 typed counts, nothing warns about the typed counts', () => {
    const storage = onCounts('6, 4, 9, 7, 5')

    expect(view(storage, settings)).toMatchObject({ kind: 'forecast', warnings: [] })
    expect(inputsScreenView(storage, settings).milestone.notes).toEqual([])
  })

  test('the Inputs screen gives the numbers the settings ask for, before anything is entered', () => {
    expect(inputsScreenView(newTeam(), settings).milestone.typedCountsNeeded).toEqual({ forForecast: 3, reliable: 5 })
  })
})

describe('refused edits change nothing and say why', () => {
  const milestone = { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '10' } as const

  test.each([
    [{ ...milestone, name: '  ' }, 'Give the milestone a name.'],
    [{ ...milestone, startDate: '' }, 'Enter the start date as a calendar date.'],
    [{ ...milestone, startDate: '2026-02-30' }, 'Enter the start date as a calendar date.'],
    [{ ...milestone, ticketsRemaining: '' }, 'Enter tickets remaining as a whole number, 0 or more.'],
    [{ ...milestone, ticketsRemaining: '-1' }, 'Enter tickets remaining as a whole number, 0 or more.'],
    [{ ...milestone, ticketsRemaining: '2.5' }, 'Enter tickets remaining as a whole number, 0 or more.'],
    [{ ...milestone, ticketsRemaining: '100001' }, 'Enter at most 100000 tickets remaining.'],
    [{ kind: 'setPaceRange', low: '8', high: '4' }, 'The low end must not be above the high end.'],
    [{ kind: 'setPaceRange', low: '1.5', high: '4' }, 'Enter whole numbers of tickets, 0 or more.'],
    [{ kind: 'setPaceRange', low: '', high: '4' }, 'Enter whole numbers of tickets, 0 or more.'],
    [{ kind: 'setPaceRange', low: '4', high: '1001' }, 'Enter at most 1000 tickets per week.'],
    [{ kind: 'setCadence', cadenceDays: '0' }, 'Enter the cadence as a whole number of days, 1 or more.'],
    [{ kind: 'setCadence', cadenceDays: '-7' }, 'Enter the cadence as a whole number of days, 1 or more.'],
    [{ kind: 'setCadence', cadenceDays: '10.5' }, 'Enter the cadence as a whole number of days, 1 or more.'],
    [{ kind: 'setCadence', cadenceDays: '' }, 'Enter the cadence as a whole number of days, 1 or more.'],
    [{ kind: 'setCadence', cadenceDays: 'two weeks' }, 'Enter the cadence as a whole number of days, 1 or more.'],
    [{ kind: 'setCadence', cadenceDays: '366' }, 'Enter a cadence of at most 365 days.'],
  ] satisfies [InputsEdit, string][])('%j: %s', (change, error) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    const before = view(storage)

    expect(edit(storage, change)).toEqual({ ok: false, error })

    expect(view(storage)).toEqual(before)
  })

  test('a cadence needs the milestone first', () => {
    const storage = newTeam()

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: false, error: 'Enter the milestone first.' })

    expect(view(storage)).toEqual({ kind: 'empty' })
  })

  test('a pace range needs the milestone first', () => {
    const storage = newTeam()

    expect(edit(storage, { kind: 'setPaceRange', low: '4', high: '8' })).toEqual({ ok: false, error: 'Enter the milestone first.' })

    expect(view(storage)).toEqual({ kind: 'empty' })
  })
})

describe('the milestone on the Inputs screen', () => {
  function inputs(storage: Storage) {
    return inputsScreenView(storage).milestone
  }

  test('before anything is entered, the start date is pre-filled with today', () => {
    expect(inputs(newTeam())).toEqual({
      name: '',
      startDate: TODAY,
      ticketsRemaining: undefined,
      cadenceDays: 7,
      ambiguity: 'medium',
      paceRange: undefined,
      paceCounts: [],
      paceMode: 'range',
      typedCountsNeeded: { forForecast: 4, reliable: 8 },
      notes: [],
    })
  })

  test('a milestone kept from before the MVP shows today pre-filled, noting that no start date is saved yet', () => {
    const storage = newTeam()
    storage.saveMilestoneInputs({
      teamId: TEAM,
      name: 'Checkout v2',
      startDate: undefined,
      ticketsRemaining: 10,
      ambiguity: 'medium',
      cadenceDays: 7,
      paceMode: 'range',
      paceRange: { low: 4, high: 8 },
      paceCounts: [],
      paceCadenceDays: undefined,
    })

    expect(inputs(storage)).toMatchObject({
      startDate: TODAY,
      notes: [{ input: 'startDate', message: 'No start date is saved yet.' }],
    })
  })

  test('shows what was entered, with each warning beside its input', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(inputs(storage)).toEqual({
      name: 'Checkout v2',
      startDate: '2026-09-01',
      ticketsRemaining: 10,
      cadenceDays: 7,
      ambiguity: 'medium',
      paceRange: { low: 0, high: 0 },
      paceCounts: [],
      paceMode: 'range',
      typedCountsNeeded: { forForecast: 4, reliable: 8 },
      notes: [{ input: 'pace', message: 'At 0 tickets a week, the work never finishes.' }],
    })
  })

  test('typed counts in use with none entered yet do not say the work never finishes', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(inputs(storage).notes).not.toContainEqual({ input: 'pace', message: 'At 0 tickets a week, the work never finishes.' })
  })
})

describe('the milestone\'s ambiguity', () => {
  function ambiguity(storage: Storage) {
    return inputsScreenView(storage).milestone.ambiguity
  }

  test('an untouched milestone is of medium ambiguity, and its forecast says it grew by the medium range', () => {
    const storage = newTeam()
    expect(ambiguity(storage)).toBe('medium')

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(ambiguity(storage)).toBe('medium')
    expect(view(storage)).toMatchObject({ dates: DATES_FROM_1_SEP, ambiguity: { level: 'medium', low: 1, high: 2 } })
  })

  test('the EM chooses high, and it is kept across a restart: the forecast grows by the high range', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(edit(storage, { kind: 'setAmbiguity', level: 'high' })).toEqual({ ok: true })

    const reopened = openStorage()
    expect(ambiguity(reopened)).toBe('high')
    expect(view(reopened)).toMatchObject({ ambiguity: { level: 'high', low: 1.5, high: 3 } })
  })

  test.each(['', 'extreme', 'Medium'])('refuses the level %j, saying why and changing nothing', (level) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setAmbiguity', level: 'low' })).toEqual({ ok: true })
    const before = view(storage)

    expect(edit(storage, { kind: 'setAmbiguity', level })).toEqual({ ok: false, error: 'Choose low, medium or high ambiguity.' })

    expect(ambiguity(storage)).toBe('low')
    expect(view(storage)).toEqual(before)
  })

  test('high ambiguity finishes no earlier than medium, and medium no earlier than low, at every confidence level', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    const datesAt = (level: string) => {
      expect(edit(storage, { kind: 'setAmbiguity', level })).toEqual({ ok: true })
      const forecast = view(storage)
      if (forecast.kind !== 'forecast') throw new Error(`no forecast at ${level} ambiguity`)
      return forecast.dates.map(({ date }) => date!)
    }

    const [low, medium, high] = [datesAt('low'), datesAt('medium'), datesAt('high')]

    for (let i = 0; i < 4; i++) {
      expect(medium[i]! >= low[i]!).toBe(true)
      expect(high[i]! >= medium[i]!).toBe(true)
    }
    expect(high[3]! > low[3]!).toBe(true)
  })

  test('a low range that would shrink the work never drops the ticket total below the tickets remaining: 10 tickets at exactly 5 a week still take 2 weeks', () => {
    const storage = newTeam()
    storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 0.5, high: 0.5 }, medium: { low: 1, high: 2 }, high: { low: 1.5, high: 3 } })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(edit(storage, { kind: 'setAmbiguity', level: 'low' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      ambiguity: { level: 'low', low: 0.5, high: 0.5 },
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })),
    })
  })

  test('an ambiguity level needs the milestone first', () => {
    const storage = newTeam()

    expect(edit(storage, { kind: 'setAmbiguity', level: 'high' })).toEqual({ ok: false, error: 'Enter the milestone first.' })

    expect(view(storage)).toEqual({ kind: 'empty' })
  })
})

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

describe('the pace trend beside typed counts', () => {
  /** The milestone with these typed counts entered, and the pace set to typed counts. */
  function withCounts(counts: string): Storage {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '30' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    return storage
  }

  test('counts of 2, 4, 6, 8 give a line from 2 to 8, on the forecast and beside the typed counts', () => {
    const storage = withCounts('2, 4, 6, 8')

    const trend = { counts: [2, 4, 6, 8], start: 2, end: 8 }
    expect(view(storage)).toMatchObject({ kind: 'forecast', paceTrend: trend })
    expect(inputsScreenView(storage).milestone.paceTrend).toEqual(trend)
  })

  test('falling counts of 8, 6, 4, 2 give a line from 8 down to 2', () => {
    const storage = withCounts('8, 6, 4, 2')

    expect(inputsScreenView(storage).milestone.paceTrend).toEqual({ counts: [8, 6, 4, 2], start: 8, end: 2 })
  })

  test('counts off the line are fitted by least squares: 6, 4, 9, 7 give a line from 5.3 to 7.7', () => {
    const storage = withCounts('6, 4, 9, 7')

    const trend = inputsScreenView(storage).milestone.paceTrend
    expect(trend?.counts).toEqual([6, 4, 9, 7])
    expect(trend?.start).toBeCloseTo(5.3, 9)
    expect(trend?.end).toBeCloseTo(7.7, 9)
  })

  test('with 3 typed counts, fewer than a forecast needs, there is no trend', () => {
    const storage = withCounts('2, 4, 6')

    expect(view(storage)).toMatchObject({ kind: 'problems' })
    expect(inputsScreenView(storage).milestone.paceTrend).toBeUndefined()
  })

  test('the trend starts at the count a forecast needs, from the settings', () => {
    const storage = withCounts('2, 4, 6')
    const settings = { ...DEFAULT_SETTINGS, typedCounts: { forForecast: 3, reliable: 8 } }

    expect(view(storage, settings)).toMatchObject({ kind: 'forecast', paceTrend: { counts: [2, 4, 6], start: 2, end: 6 } })
    expect(inputsScreenView(storage, settings).milestone.paceTrend).toEqual({ counts: [2, 4, 6], start: 2, end: 6 })
  })

  test('with the range in use beside 4 typed counts, there is no trend', () => {
    const storage = withCounts('2, 4, 6, 8')

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'range' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ kind: 'forecast', paceTrend: undefined })
    expect(inputsScreenView(storage).milestone.paceTrend).toBeUndefined()
  })

  test('the trend changes nothing in the forecast: rising counts of 2, 4, 6, 8 forecast the dates they did before it, with no note', () => {
    const storage = withCounts('2, 4, 6, 8')

    expect(view(storage)).toMatchObject({
      kind: 'forecast',
      dates: engineDatesForTypedCounts([2, 4, 6, 8]),
      warnings: [{ input: 'typedCounts', message: 'Typed counts: 4 weeks entered. The forecast needs 8 to be reliable.' }],
    })
    expect(inputsScreenView(storage).milestone.notes).toEqual([{ input: 'typedCounts', message: '4 of 8 needed for reliable results' }])
  })
})

/**
 * 30 tickets from the typed counts, growing 1–2×, weekly from 1 Sep 2026, simulated by the engine directly,
 * with no pace trend anywhere in the path: the dates the forecast gave before the trend existed.
 */
function engineDatesForTypedCounts(counts: number[]) {
  const result = simulateCase({
    engineVersion: ENGINE_VERSION,
    seed: DEFAULT_SETTINGS.seed,
    trials: DEFAULT_SETTINGS.trials,
    maxPeriods: DEFAULT_SETTINGS.maxPeriods,
    question: { kind: 'when' },
    startDate: '2026-09-01',
    periodDays: 7,
    scope: [{ epicId: TEAM, rank: 1, baseCount: 30, currentCount: 30, doneCount: 0, growth: { low: 1, high: 2 } }],
    throughputSamples: counts,
    epicSizeSamples: { low: 0, high: 0 },
    percentiles: DEFAULT_SETTINGS.percentiles,
  })
  return DEFAULT_SETTINGS.percentiles.map((percent) => ({ percent, date: result.percentileDates[percent] }))
}
