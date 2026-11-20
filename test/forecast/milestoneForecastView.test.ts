import { describe, expect, test } from 'vitest'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { ENGINE_VERSION, simulateCase } from '../../src/engine/index.js'
import type { Storage } from '../../src/storage/storage.js'
import { TEAM, openStorage, newTeam, mediumGrowth, edit, enter, DATES_FROM_1_SEP, DATES_FROM_15_SEP, view, inputsScreenView } from './forecastViewScenario.js'

// Seam B: the Milestone forecast view from what the EM enters: its dates, finish graph and start date, and the pace
// trend. Arranged through forecastViewScenario.ts; the pace, the Inputs screen and its forms have files beside this one.

describe('the forecast from what the EM enters', () => {
  test('starts on the start date: 10 tickets at exactly 5 a week, with no growth, finish 2 weeks after it', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(view(storage)).toEqual({
      kind: 'forecast',
      name: 'Checkout v2',
      ticketsRemaining: 10,
      ticketsRemainingSaid: '10 tickets',
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
      period: 'week',
      pace: { source: 'range', low: 5, high: 5 },
      paceSaid: '5–5 tickets per week (range)',
      ambiguity: { level: 'medium', low: 1, high: 1 },
      warnings: [],
      finishGraph: [
        { date: '2026-09-01', share: 0, finishedBy: 0, capacity: 100 },
        { date: '2026-09-08', share: 0, finishedBy: 0, capacity: 100 },
        { date: '2026-09-15', share: 1, finishedBy: 1, capacity: 100 },
      ],
      paceTrend: undefined,
      capacity: {
        on: true,
        open: false,
        summary: 'none, every week usual',
        entries: [],
        past: [],
        form: { percent: '', from: '', to: '', onward: false, note: '' },
      },
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
    expect(finishGraph.at(-1)?.finishedBy).toBe(1)
    expect(finishGraph.at(-1)?.share).toBeGreaterThan(0)
  })

  test('each bar is the share of trials finishing that week, so the slowest week holds a few trials, not a whole percent', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { finishGraph } = graph(storage)
    const firstFinish = finishGraph.findIndex(({ share }) => share > 0)

    expect(finishGraph.at(-1)?.share).toBeLessThan(0.01)
    expect(finishGraph.slice(firstFinish).every(({ share }) => share > 0)).toBe(true)
  })

  test('each confidence date falls on the first bar by which that share of trials has finished', () => {
    const storage = newTeam()
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { finishGraph, dates } = graph(storage)

    for (const { percent, date } of dates) {
      expect(finishGraph.find(({ finishedBy }) => finishedBy >= percent / 100)?.date).toBe(date)
    }
  })

  test('when some trials run past the horizon, the bars stop at the last finish within it and their shares sum to the share that finished', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })

    // 150 tickets at 0–2 a week, 1 on average: about 150 weeks, close to the 156-week horizon
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '150' }, { low: '0', high: '2' })

    const { finishGraph, dates, horizonDate } = graph(storage)
    const finished = finishGraph.at(-1)?.finishedBy ?? 0

    expect(dates.find(({ percent }) => percent === 85)?.date).toBeNull()
    expect(finished).toBeGreaterThan(0.5)
    expect(finished).toBeLessThan(0.85)
    expect(sum(finishGraph.map((bar) => bar.share))).toBeCloseTo(finished, 9)
    expect(finishGraph.at(-1)?.date.localeCompare(horizonDate)).toBeLessThanOrEqual(0)
  })

  test('0 tickets remaining: one bar, on the start date, holding every trial', () => {
    const storage = newTeam()

    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '0' }, { low: '4', high: '8' })

    expect(graph(storage).finishGraph).toEqual([{ date: '2026-09-01', share: 1, finishedBy: 1, capacity: 100 }])
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
      { date: '2026-09-01', share: 0, finishedBy: 0, capacity: 100 },
      { date: '2026-09-15', share: 0, finishedBy: 0, capacity: 100 },
      { date: '2026-09-29', share: 1, finishedBy: 1, capacity: 100 },
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
