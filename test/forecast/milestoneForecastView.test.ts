import { describe, expect, test } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/forecast/index.js'
import { ENGINE_VERSION, simulateCase } from '../../src/engine/index.js'
import type { ForecastingForTest } from './forecastingForTest.js'
import { mediumGrowth } from './forecastingForTest.js'
import { TEAM, newTeam, edit, enter, DATES_FROM_1_SEP, DATES_FROM_15_SEP, view, inputsScreenView } from './forecastViewScenario.js'

// Seam B: the Milestone forecast view from what the EM enters: its dates, finish graph and start date, and the pace
// trend. Arranged through forecastViewScenario.ts; the pace, the Inputs screen and its forms have files beside this one.

describe('the forecast from what the EM enters', () => {
  test('starts on the start date: 10 tickets at exactly 5 a week, with no growth, finish 2 weeks after it', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(await view(team)).toEqual({
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
      finishGraph: {
        bars: [
          { period: 0, date: '2026-09-01', share: 0, finishedBy: 0, capacity: 100 },
          { period: 1, date: '2026-09-08', share: 0, finishedBy: 0, capacity: 100 },
          { period: 2, date: '2026-09-15', share: 1, finishedBy: 1, capacity: 100 },
        ],
        later: undefined,
      },
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

  test('100 tickets at 4–8 a week, growing by the default medium range, from the fixed seed', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await view(team)).toMatchObject({
      kind: 'forecast',
      dates: DATES_FROM_1_SEP,
      pace: { source: 'range', low: 4, high: 8 },
    })
  })

  test('moving the start date moves every date by the same gap', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await edit(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-15', ticketsRemaining: '100' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({ startDate: '2026-09-15', dates: DATES_FROM_15_SEP })
  })

  test('the same inputs always give the same forecast', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await view(team)).toEqual(await view(team))
  })

  test('300 tickets at 1.5 a week take 200 weeks: every confidence level is beyond the 156-week horizon, so has no date, and the horizon date is given to show "later than"', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '300' }, { low: '0', high: '3' })

    expect(await view(team)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null })),
      horizonDate: '2029-08-28',
    })
  })

  test('zero pace gives no date at all, and a warning on the pace', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(await view(team)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null })),
      warnings: [{ input: 'pace', message: 'At 0 tickets a week, the work never finishes.' }],
    })
  })

  test('0 tickets remaining finishes on the start date', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '0' }, { low: '0', high: '0' })

    expect(await view(team)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: '2026-09-01' })),
      warnings: [],
    })
  })

  test('inputs are kept across a restart', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    team.restart()

    expect(await view(team)).toMatchObject({ name: 'Checkout v2', startDate: '2026-09-01', dates: DATES_FROM_1_SEP })
  })
})

describe('the finish graph', () => {
  async function graph(team: ForecastingForTest) {
    const forecast = await view(team)
    if (forecast.kind !== 'forecast') throw new Error(`no forecast: ${forecast.kind}`)
    return forecast
  }
  const sum = (shares: number[]) => shares.reduce((total, share) => total + share, 0)

  test('has a bar for each week from the start date to the week 99% of trials have finished by, each finished-by share the running sum of the shares', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { bars } = (await graph(team)).finishGraph

    expect(bars.slice(0, 2).map(({ date }) => date)).toEqual(['2026-09-01', '2026-09-08'])
    bars.forEach(({ finishedBy }, i) => expect(finishedBy).toBeCloseTo(sum(bars.slice(0, i + 1).map((bar) => bar.share)), 9))
    expect(bars.at(-1)?.finishedBy).toBeGreaterThanOrEqual(0.99)
    expect(bars.at(-2)?.finishedBy).toBeLessThan(0.99)
  })

  test('each bar is the share of trials finishing that week, every week from the first finish holding some', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const { bars } = (await graph(team)).finishGraph
    const firstFinish = bars.findIndex(({ share }) => share > 0)

    expect(bars.slice(firstFinish).every(({ share }) => share > 0)).toBe(true)
  })

  test('each confidence date falls on the first bar by which that share of trials has finished', async () => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })

    const {
      finishGraph: { bars },
      dates,
    } = await graph(team)

    for (const { percent, date } of dates) {
      expect(bars.find(({ finishedBy }) => finishedBy >= percent / 100)?.date).toBe(date)
    }
  })

  test('when some trials run past the horizon, the bars stop at the last finish within it and their shares sum to the share that finished', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })

    // 150 tickets at 0–2 a week, 1 on average: about 150 weeks, close to the 156-week horizon
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '150' }, { low: '0', high: '2' })

    const {
      finishGraph: { bars },
      dates,
      horizonDate,
    } = await graph(team)
    const finished = bars.at(-1)?.finishedBy ?? 0

    expect(dates.find(({ percent }) => percent === 85)?.date).toBeNull()
    expect(finished).toBeGreaterThan(0.5)
    expect(finished).toBeLessThan(0.85)
    expect(sum(bars.map((bar) => bar.share))).toBeCloseTo(finished, 9)
    expect(bars.at(-1)?.date.localeCompare(horizonDate)).toBeLessThanOrEqual(0)
  })

  /** 30 tickets growing 1–2×, on typed counts with a slow week in six: a few trials run far past the rest. */
  async function slowTail(settings = DEFAULT_SETTINGS, counts = '0 1 1 2 8 12'): Promise<ForecastingForTest> {
    const team = await newTeam(settings)
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '30' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    return team
  }

  test('ends on the 99% date, 3 Aug 2027, not at the slowest trial a year later, so the bars that carry the forecast fill the graph', async () => {
    const team = await slowTail()

    const { bars } = (await graph(team)).finishGraph

    // the engine's 99% date and last finish for the fixed seed: 3 Aug 2027 and 8 Aug 2028
    expect(bars.at(-1)?.date).toBe('2027-08-03')
    expect(bars.at(-1)?.finishedBy).toBeGreaterThanOrEqual(0.99)
    expect(bars.at(-2)?.finishedBy).toBeLessThan(0.99)
  })

  test('the trials finishing after the 99% date are summed under the graph: under 1% of them, the last on 8 Aug 2028', async () => {
    const team = await slowTail()

    const { bars, later } = (await graph(team)).finishGraph
    const shown = bars.at(-1)?.finishedBy ?? 0

    expect(later?.last).toEqual({ kind: 'by', date: '2028-08-08', period: 101 })
    expect(later?.share).toBeCloseTo(1 - shown, 9)
    expect(later?.share).toBeGreaterThan(0)
    expect(later?.share).toBeLessThanOrEqual(0.01)
  })

  test('with a confidence level of 100% the graph runs to its date, the last finish, so every marker stays on it, and no trial is left to sum', async () => {
    const team = await slowTail({ ...DEFAULT_SETTINGS, percentiles: [50, 85, 100] })

    const forecast = await graph(team)

    expect(forecast.dates.at(-1)).toEqual({ percent: 100, date: '2028-08-08', alreadyPast: false })
    expect(forecast.finishGraph.bars.at(-1)).toMatchObject({ date: '2028-08-08', finishedBy: 1 })
    expect(forecast.finishGraph.later).toBeUndefined()
  })

  test('when some trials finish after the 99% date and beyond the horizon, the sum under the graph has no last date', async () => {
    const team = await slowTail(DEFAULT_SETTINGS, '0 0 0 1 1 2 8 12')

    const { bars, later } = (await graph(team)).finishGraph

    // the engine's 99% date for the fixed seed; a few of the 10,000 trials don't finish within the 156 weeks
    expect(bars.at(-1)?.date).toBe('2028-03-07')
    expect(later).toEqual({ share: expect.closeTo(1 - (bars.at(-1)?.finishedBy ?? 0), 9), last: { kind: 'beyondHorizon' } })
  })

  test('a forecast whose trials all finish by the 99% date has nothing to sum under the graph', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect((await graph(team)).finishGraph.later).toBeUndefined()
  })

  test('0 tickets remaining: one bar, on the start date, holding every trial', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '0' }, { low: '4', high: '8' })

    expect((await graph(team)).finishGraph.bars).toEqual([{ period: 0, date: '2026-09-01', share: 1, finishedBy: 1, capacity: 100 }])
  })

  test('zero pace: no trial finishes, so there are no bars', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect((await graph(team)).finishGraph.bars).toEqual([])
  })

  test('at a 14-day cadence, a bar per sprint: 10 tickets at exactly 5 a sprint, with no growth, all finish in the second sprint', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(await edit(team, { kind: 'setCadence', cadenceDays: '14' })).toEqual({ ok: true })

    expect((await graph(team)).finishGraph.bars).toEqual([
      { period: 0, date: '2026-09-01', share: 0, finishedBy: 0, capacity: 100 },
      { period: 1, date: '2026-09-15', share: 0, finishedBy: 0, capacity: 100 },
      { period: 2, date: '2026-09-29', share: 1, finishedBy: 1, capacity: 100 },
    ])
  })
})

describe('a start date in the past', () => {
  test('is stated as such, with the exact number of days before today, naming the start date', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-05-24', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await view(team)).toMatchObject({
      warnings: [{ input: 'startDate', message: "Start date is 92 days before today; tickets remaining are still today's count." }],
    })
  })

  test.each(['2026-08-24', '2026-08-25'])('a start date of today or later, %s, has no note', async (startDate) => {
    const team = await newTeam()

    await enter(team, { startDate, ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await view(team)).toMatchObject({ warnings: [] })
  })

  test('a start date the day before today says 1 day', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-08-23', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect(await view(team)).toMatchObject({
      warnings: [{ input: 'startDate', message: "Start date is 1 day before today; tickets remaining are still today's count." }],
    })
  })
})

describe('a start date in the past, on the Inputs screen', () => {
  test('shows the same note beside the start date', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-05-24', ticketsRemaining: '100' }, { low: '4', high: '8' })

    expect((await inputsScreenView(team)).milestone.notes).toEqual([
      { input: 'startDate', message: "Start date is 92 days before today; tickets remaining are still today's count." },
    ])
  })
})

describe('forecast dates before today', () => {
  test('are marked already past, and dates on or after today are not', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })

    // 10 tickets at 1–9 a week from 3 Aug: some trials finish by 17 Aug, a week before today, others on or after it
    await enter(team, { startDate: '2026-08-03', ticketsRemaining: '10' }, { low: '1', high: '9' })

    expect(await view(team)).toMatchObject({
      dates: [
        { percent: 50, date: '2026-08-17', alreadyPast: true },
        { percent: 70, date: '2026-08-24', alreadyPast: false },
        { percent: 85, date: '2026-08-24', alreadyPast: false },
        { percent: 95, date: '2026-08-31', alreadyPast: false },
      ],
    })
  })

  test('later than the horizon is never already past', async () => {
    const team = await newTeam()

    await enter(team, { startDate: '2026-05-24', ticketsRemaining: '10' }, { low: '0', high: '0' })

    expect(await view(team)).toMatchObject({
      dates: [50, 70, 85, 95].map((percent) => ({ percent, date: null, alreadyPast: false })),
    })
  })
})

describe('the pace trend beside typed counts', () => {
  /** The milestone with these typed counts entered, and the pace set to typed counts. */
  async function withCounts(counts: string): Promise<ForecastingForTest> {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '30' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setPaceCounts', counts })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })
    return team
  }

  test('counts of 2, 4, 6, 8 give a line from 2 to 8, on the forecast and beside the typed counts', async () => {
    const team = await withCounts('2, 4, 6, 8')

    const trend = { counts: [2, 4, 6, 8], start: 2, end: 8 }
    expect(await view(team)).toMatchObject({ kind: 'forecast', paceTrend: trend })
    expect((await inputsScreenView(team)).milestone.paceTrend).toEqual(trend)
  })

  test('falling counts of 8, 6, 4, 2 give a line from 8 down to 2', async () => {
    const team = await withCounts('8, 6, 4, 2')

    expect((await inputsScreenView(team)).milestone.paceTrend).toEqual({ counts: [8, 6, 4, 2], start: 8, end: 2 })
  })

  test('counts off the line are fitted by least squares: 6, 4, 9, 7 give a line from 5.3 to 7.7', async () => {
    const team = await withCounts('6, 4, 9, 7')

    const trend = (await inputsScreenView(team)).milestone.paceTrend
    expect(trend?.counts).toEqual([6, 4, 9, 7])
    expect(trend?.start).toBeCloseTo(5.3, 9)
    expect(trend?.end).toBeCloseTo(7.7, 9)
  })

  test('with 3 typed counts, fewer than a forecast needs, there is no trend', async () => {
    const team = await withCounts('2, 4, 6')

    expect(await view(team)).toMatchObject({ kind: 'problems' })
    expect((await inputsScreenView(team)).milestone.paceTrend).toBeUndefined()
  })

  test('the trend starts at the count a forecast needs, from the settings', async () => {
    const team = await withCounts('2, 4, 6')
    team.restart({ ...DEFAULT_SETTINGS, typedCounts: { forForecast: 3, reliable: 8 } })

    expect(await view(team)).toMatchObject({ kind: 'forecast', paceTrend: { counts: [2, 4, 6], start: 2, end: 6 } })
    expect((await inputsScreenView(team)).milestone.paceTrend).toEqual({ counts: [2, 4, 6], start: 2, end: 6 })
  })

  test('with the range in use beside 4 typed counts, there is no trend', async () => {
    const team = await withCounts('2, 4, 6, 8')

    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'range' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({ kind: 'forecast', paceTrend: undefined })
    expect((await inputsScreenView(team)).milestone.paceTrend).toBeUndefined()
  })

  test('the trend changes nothing in the forecast: rising counts of 2, 4, 6, 8 forecast the dates they did before it, with no note', async () => {
    const team = await withCounts('2, 4, 6, 8')

    expect(await view(team)).toMatchObject({
      kind: 'forecast',
      dates: engineDatesForTypedCounts([2, 4, 6, 8]),
      warnings: [{ input: 'typedCounts', message: 'Typed counts: 4 weeks entered. The forecast needs 8 to be reliable.' }],
    })
    expect((await inputsScreenView(team)).milestone.notes).toEqual([{ input: 'typedCounts', message: '4 of 8 needed for reliable results' }])
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
