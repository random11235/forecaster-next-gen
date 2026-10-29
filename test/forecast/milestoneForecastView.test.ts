import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { editInputs, inputsView, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
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

function edit(storage: Storage, change: InputsEdit) {
  return editInputs(storage, TEAM, change)
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

function view(storage: Storage) {
  return milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)
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

    expect(inputsView(storage, TEAM, TODAY).milestone.notes).toEqual([
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

  test('a forecast at the untouched cadence is in 7-day periods', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(view(storage)).toMatchObject({ cadenceDays: 7, dates: DATES_FROM_1_SEP, horizonDate: '2029-08-28' })
  })

  test('at a 14-day cadence, zero pace warns of 0 tickets a sprint, beside the pace and on the forecast', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    const warning = { input: 'pace', message: 'At 0 tickets a sprint, the work never finishes.' }
    expect(view(storage)).toMatchObject({ warnings: [warning] })
    expect(inputsView(storage, TEAM, TODAY).milestone.notes).toEqual([warning])
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

    expect(inputsView(openStorage(), TEAM, TODAY).milestone.cadenceDays).toBe(14)
    expect(view(openStorage())).toMatchObject({ cadenceDays: 14, horizonDate: '2032-08-24' })
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

  test('with 1 typed count there is no forecast, and the note saying why sits beside the pace too', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceCounts', counts: '6' })).toEqual({ ok: true })

    const note = {
      input: 'pace',
      message: 'Typed counts: 1 week entered. The forecast needs at least 2. Add another count, or switch pace to the range.',
    }
    expect(view(storage)).toEqual({ kind: 'problems', name: 'Checkout v2', problems: [note] })
    expect(inputsView(storage, TEAM, TODAY).milestone.notes).toEqual([note])
  })

  test.each([
    ['2, 3', 2],
    ['6, 4, 9, 7', 4],
    ['6, 4, 9, 7, 5, 8, 6', 7],
  ])('with typed counts %s in use, the forecast warns it needs 8 to be reliable, and the Inputs screen says so beside the pace', (counts, entered) => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      kind: 'forecast',
      warnings: [{ input: 'pace', message: `Typed counts: ${entered} weeks entered. The forecast needs 8 to be reliable.` }],
    })
    expect(inputsView(storage, TEAM, TODAY).milestone.notes).toEqual([{ input: 'pace', message: `${entered} of 8 needed for reliable results` }])
  })

  test('at a 14-day cadence, the reliability warning counts sprints', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({
      warnings: [{ input: 'pace', message: 'Typed counts: 4 sprints entered. The forecast needs 8 to be reliable.' }],
    })
  })

  test('with the range in use beside 4 typed counts, or 8 typed counts in use, nothing warns about the typed counts', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7' })).toEqual({ ok: true })
    expect(view(storage)).toMatchObject({ kind: 'forecast', pace: { source: 'range' }, warnings: [] })
    expect(inputsView(storage, TEAM, TODAY).milestone.notes).toEqual([])

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '6, 4, 9, 7, 5, 8, 6, 7' })).toEqual({ ok: true })

    expect(view(storage)).toMatchObject({ kind: 'forecast', pace: { source: 'counts' }, warnings: [] })
    expect(inputsView(storage, TEAM, TODAY).milestone.notes).toEqual([])
  })

  test('the EM adds a count, removes the last one, and edits the list, oldest first, and the counts are kept across a restart', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '4', high: '8' })
    const counts = () => inputsView(openStorage(), TEAM, TODAY).milestone.paceCounts

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

    expect(inputsView(storage, TEAM, TODAY).milestone.paceCounts).toEqual([])
  })

  test('switching between the range and typed counts keeps both across a restart, and the forecast uses the one chosen', () => {
    let storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    expect(edit(storage, { kind: 'setPaceCounts', counts: '10, 10' })).toEqual({ ok: true })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    storage = openStorage()
    expect(view(storage)).toMatchObject({ pace: { source: 'counts', counts: [10, 10] }, dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-08' })) })
    expect(inputsView(storage, TEAM, TODAY).milestone).toMatchObject({ paceMode: 'counts', paceRange: { low: 5, high: 5 } })

    expect(edit(storage, { kind: 'setPaceMode', paceMode: 'range' })).toEqual({ ok: true })
    storage = openStorage()
    expect(view(storage)).toMatchObject({ pace: { source: 'range', low: 5, high: 5 }, dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-15' })) })
    expect(inputsView(storage, TEAM, TODAY).milestone).toMatchObject({ paceMode: 'range', paceCounts: [10, 10] })
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
    expect(inputsView(storage, TEAM, TODAY).milestone.paceCounts).toEqual([6, 4, 9])
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
      problems: [{ message: 'Typed counts: 0 sprints entered. The forecast needs at least 2. Add another count, or switch pace to the range.' }],
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
    })

    expect(view(storage)).toEqual({
      kind: 'problems',
      name: 'Checkout v2',
      problems: [
        { input: 'startDate', message: 'No start date is saved yet.' },
        {
          input: 'pace',
          message: 'Typed counts: 1 week entered. The forecast needs at least 2. Add another count, or switch pace to the range.',
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
    return inputsView(storage, TEAM, TODAY).milestone
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
      notes: [{ input: 'pace', message: 'At 0 tickets a week, the work never finishes.' }],
    })
  })
})

describe('the milestone\'s ambiguity', () => {
  function ambiguity(storage: Storage) {
    return inputsView(storage, TEAM, TODAY).milestone.ambiguity
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
    return inputsView(storage, TEAM, TODAY).growth.ranges
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
