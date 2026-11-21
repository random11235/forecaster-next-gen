import { beforeEach, describe, expect, test } from 'vitest'
import type { Ticket } from '../../src/connectors/connector.js'
import { finishedInWeeks as finishedInWeeksOf } from '../trackerScenario.js'
import {
  CHECKOUT,
  checkoutFixture,
  countAgain,
  forecastingForTest,
  pick,
  readAgain,
  skip as skipOf,
  TEAM,
  type ForecastingForTest,
  submitInputs,
} from './forecastingForTest.js'

// Skipping a tracker period (#213): pace stays on the tracker, its window reaching back past the skipped periods to
// keep up to 8 counted; skips belong to the milestone and outlast reads, and can be counted again.

// Thursday 12 Nov, today; with nothing skipped the read reaches back 9 weeks, to Thursday 10 Sep, so whole from Monday 14 Sep
const READ_AT = '2026-11-12T09:00:00Z'
const NEXT_READ_AT = '2026-11-12T14:30:00Z'
// a Monday, long before the reads reach
const START = '2026-08-10'

// Mondays of the weeks GitHub has finished tickets in: two before the first read reaches, then the 8 it reaches whole
const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
const COUNTS = [4, 6, 3, 5, 6, 4, 7, 5, 6, 8]
// the holiday weeks, 12 and 19 Oct
const HOLIDAYS = ['2026-10-12', '2026-10-19']

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] => finishedInWeeksOf(WEEKS, counts)

let scenario: ForecastingForTest
/** How far back each read asked GitHub for finished tickets, since the milestone was set up. */
let asked: string[]

beforeEach(async () => {
  scenario = await forecastingForTest({ fixture: checkoutFixture([{ id: 'o1' }, ...finishedInWeeks(COUNTS)]), connected: true })
  await submitInputs(scenario, { kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  await submitInputs(scenario, { kind: 'setPaceRange', low: '4', high: '8' })
  await pick(scenario, READ_AT)
  await submitInputs(scenario, { kind: 'setPaceMode', paceMode: 'tracker' })
  asked = scenario.calls.since
  forgetAsked()
})

/** Forgets the reads asked for so far, to count those after. */
const forgetAsked = () => void scenario.calls.since.splice(0)

const reading = async () => (await scenario.inputsScreen()).inputs.milestone.trackerPace?.reading

const forecast = () => scenario.milestoneForecastView()

const skip = (periods: string[]) => skipOf(scenario, periods, READ_AT)

describe('skipping a period', () => {
  test('keeps 8 counted by reaching back past the skipped weeks, reading GitHub further back to do so', async () => {
    await skip(HOLIDAYS)

    // 11 weeks back from Thursday 12 Nov: the 8 counted, the 2 skipped, and the current one
    expect(asked).toEqual(['2026-08-27T09:00:00.000Z'])
    expect(await reading()).toMatchObject({
      // the skipped weeks are gaps among those counted
      periods: [
        { start: '2026-08-31', count: 4, skipped: false },
        { start: '2026-09-07', count: 6, skipped: false },
        { start: '2026-09-14', count: 3, skipped: false },
        { start: '2026-09-21', count: 5, skipped: false },
        { start: '2026-09-28', count: 6, skipped: false },
        { start: '2026-10-05', count: 4, skipped: false },
        { start: '2026-10-12', count: 7, skipped: true },
        { start: '2026-10-19', count: 5, skipped: true },
        { start: '2026-10-26', count: 6, skipped: false },
        { start: '2026-11-02', count: 8, skipped: false },
      ],
      counts: [4, 6, 3, 5, 6, 4, 6, 8],
      line: 'last 8 weeks · read 12 Nov 09:00',
      skipped: { line: '2 skipped (12 Oct, 19 Oct), reaching back to w/c 31 Aug', starts: HOLIDAYS },
    })
    expect(scenario.storage.milestoneInputs(TEAM)).toMatchObject({ paceMode: 'tracker', paceWindow: { skippedPeriods: HOLIDAYS } })
  })

  test('the forecast’s pace says how many are skipped', async () => {
    await skip(HOLIDAYS)

    expect(await forecast()).toMatchObject({
      kind: 'forecast',
      pace: { source: 'tracker', tracker: 'GitHub', counts: [4, 6, 3, 5, 6, 4, 6, 8], skipped: 2 },
      paceSaid: 'GitHub’s last 8 weeks, 2 skipped',
    })
  })

  test('with GitHub holding no earlier weeks, fewer are counted, and the skip line says so', async () => {
    scenario.fixture.reads[CHECKOUT.query] = { tickets: finishedInWeeks([0, 0, ...COUNTS.slice(2)]), incomplete: false }
    await submitInputs(scenario, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-14', ticketsRemaining: '30' })

    await skip(HOLIDAYS)

    expect(await reading()).toMatchObject({
      counts: [3, 5, 6, 4, 6, 8],
      skipped: { line: '2 skipped (12 Oct, 19 Oct), and GitHub has no earlier weeks to count instead' },
    })
  })

  test('skips outlast a read: the next one reaches back past them too, and they stay skipped', async () => {
    await skip(HOLIDAYS)
    scenario.fixture.reads[CHECKOUT.query] = { tickets: [...finishedInWeeks(COUNTS), { id: 'late', finishedAt: '2026-11-06T10:00:00Z' }], incomplete: false }
    forgetAsked()

    await readAgain(scenario, NEXT_READ_AT)

    // the Milestone step's read reaches 11 weeks back, past the skips, as the skip's own did
    expect(asked).toEqual(['2026-08-27T14:30:00.000Z'])
    expect(await reading()).toMatchObject({
      counts: [4, 6, 3, 5, 6, 4, 6, 9],
      line: 'last 8 weeks · read 12 Nov 14:30',
      skipped: { starts: HOLIDAYS },
    })
  })

  test('when GitHub can’t be read further back, the skip is kept and the last read stays in use', async () => {
    scenario.fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    expect(await skip(HOLIDAYS)).toEqual({ kind: 'saved', next: { kind: 'paceTracker' } })

    expect(asked).toEqual(['2026-08-27T09:00:00.000Z'])
    // the read of 09:00 reaches whole from 14 Sep: 6 weeks counted around the 2 skipped, and the line says where it runs out
    expect(await reading()).toMatchObject({
      counts: [3, 5, 6, 4, 6, 8],
      line: '6 weeks · GitHub has nothing before w/c 14 Sep · read 12 Nov 09:00',
      skipped: { starts: HOLIDAYS },
    })
  })
})

describe('a skip submitted', () => {
  test('saved, it goes back to the tracker’s pace on the Inputs screen', async () => {
    expect(await skip(HOLIDAYS)).toEqual({ kind: 'saved', next: { kind: 'paceTracker' } })
  })

  test('with no period, or one that isn’t a date, it is refused, saying why, and nothing is skipped', async () => {
    for (const periods of [[], ['next Tuesday']]) {
      expect(await skip(periods)).toMatchObject({
        kind: 'refused',
        view: { inputs: { milestone: { paceMode: 'tracker' }, refusal: { form: 'paceSkip', error: 'Choose a week to skip.' } } },
      })
    }
    expect(scenario.storage.milestoneInputs(TEAM)?.paceWindow.skippedPeriods).toEqual([])
    expect(asked).toEqual([])
  })

  test('with no milestone, it is refused', async () => {
    const other = await forecastingForTest({ connected: true })

    expect(await skipOf(other, HOLIDAYS, READ_AT)).toMatchObject({
      kind: 'refused',
      view: { inputs: { refusal: { form: 'paceSkip', error: 'Enter the milestone first.' } } },
    })
  })
})

describe('counting skipped periods again', () => {
  test('one counted again counts in the window again, reading nothing', async () => {
    await skip(HOLIDAYS)
    forgetAsked()

    await countAgain(scenario, ['2026-10-19'], READ_AT)

    expect(asked).toEqual([])
    expect(await reading()).toMatchObject({
      counts: [6, 3, 5, 6, 4, 5, 6, 8],
      skipped: { line: '1 skipped (12 Oct), reaching back to w/c 7 Sep', starts: ['2026-10-12'] },
    })
  })

  test('all counted again, the window is the last 8 weeks as before, and skipping one already reached reads nothing', async () => {
    await skip(HOLIDAYS)
    await countAgain(scenario, HOLIDAYS, READ_AT)

    expect(await reading()).toMatchObject({ counts: [3, 5, 6, 4, 7, 5, 6, 8], skipped: undefined })

    forgetAsked()
    await skip(['2026-10-12'])
    expect(asked).toEqual([])
  })
})

describe('every period skipped', () => {
  test('there is no pace, and no forecast: count a week again, or use typed counts or the range', async () => {
    // started on the first week GitHub finished anything in, so its pace counts no earlier weeks
    await submitInputs(scenario, { kind: 'setMilestone', name: 'Checkout v2', startDate: WEEKS[0] ?? START, ticketsRemaining: '30' })

    await skip(WEEKS)

    expect(await reading()).toMatchObject({
      counts: [],
      line: 'every week skipped · read 12 Nov 09:00',
      skipped: { line: expect.stringMatching(/^10 skipped \(31 Aug, .*, 2 Nov\), so no weeks count$/) },
    })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'pace', message: 'Every week is skipped, so GitHub gives no pace. Count a week again, or use typed counts or the range.' }],
    })
  })

  test('with every week that finished something skipped, and quiet ones before them not, it says so: there is no pace', async () => {
    // started 10 Aug: the quiet weeks before 31 Aug are read, and not skipped
    await skip(WEEKS)

    expect(await reading()).toMatchObject({ counts: [], line: 'every week that finished something skipped · read 12 Nov 09:00' })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        {
          input: 'pace',
          message: 'Every week that finished something is skipped, so GitHub gives no pace. Count a week again, or use typed counts or the range.',
        },
      ],
    })
  })
})
