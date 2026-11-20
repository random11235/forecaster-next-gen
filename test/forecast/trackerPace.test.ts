import { beforeEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import type { InputsEdit } from '../../src/forecast/index.js'
import { finishedOn, finishedInWeeks as finishedInWeeksOf } from '../trackerScenario.js'
import { CHECKOUT, checkoutFixture, CONNECTIONS, forecastingForTest, NOW, pick, type ForecastingForTest } from './forecastingForTest.js'

// Pace following the tracker (#212): up to the 8 most recent whole periods it reads, the current one left out, quiet
// ones 0, leaving out quiet periods before the first finished ticket.

// Thursday 12 Nov, today; at the weekly cadence, with nothing skipped, the read reaches back 9 weeks, to 09:00 on
// Thursday 10 Sep: the 8 whole weeks pace counts, and the current one.
const READ_AT = '2026-11-12T09:00:00Z'
// a Monday, long before the read reaches, so the milestone's own pace counts every week the read reaches whole
const START = '2026-08-31'

// The weeks the read reaches whole, from Monday 14 Sep; the current week, of 9 Nov, is left out.
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] => finishedInWeeksOf(WEEKS, counts)

const OFFLINE = { connected: false }

const OPEN: Ticket[] = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]

let team: ForecastingForTest

beforeEach(async () => {
  team = await forecastingForTest({ fixture: checkoutFixture([...OPEN, ...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8])]) })
})

/** Each as the local server build shows it, with the tracker's reads; `OFFLINE` as the browser build does. */
const build = (shown?: { connected: boolean }) => (shown?.connected === false ? team.browserBuild() : team)

const submit = (edit: InputsEdit, shown?: { connected: boolean }) => build(shown).submit({ form: 'inputs', edit })

const inputs = async (shown?: { connected: boolean }) => (await build(shown).inputsScreen()).inputs

const forecast = (shown?: { connected: boolean }) => build(shown).milestoneForecastView()

const connectGitHub = () => team.submit({ form: 'connection', edit: CONNECTIONS.github })

/** The milestone at `cadenceDays`, with a pace range and typed counts kept, its tickets picked and read. */
async function enterAndPick({ cadenceDays = '7' } = {}): Promise<void> {
  await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  await submit({ kind: 'setCadence', cadenceDays })
  await submit({ kind: 'setPaceRange', low: '4', high: '8' })
  await submit({ kind: 'setPaceCounts', counts: '1, 2, 3, 4' })
  await pick(team, READ_AT)
}

describe('following GitHub', () => {
  beforeEach(async () => {
    await connectGitHub()
  })

  test('pace can follow GitHub: its counts of the last 8 weeks, the current one left out, which the forecast uses', async () => {
    await enterAndPick()

    expect(await submit({ kind: 'setPaceMode', paceMode: 'tracker' })).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'forecast' } })

    expect((await inputs()).milestone).toMatchObject({
      paceMode: 'tracker',
      paceUsed: 'tracker',
      trackerPace: {
        tracker: 'GitHub',
        reading: {
          periods: [
            { start: '2026-09-14', count: 3, skipped: false },
            { start: '2026-09-21', count: 5, skipped: false },
            { start: '2026-09-28', count: 6, skipped: false },
            { start: '2026-10-05', count: 4, skipped: false },
            { start: '2026-10-12', count: 7, skipped: false },
            { start: '2026-10-19', count: 5, skipped: false },
            { start: '2026-10-26', count: 6, skipped: false },
            { start: '2026-11-02', count: 8, skipped: false },
          ],
          counts: [3, 5, 6, 4, 7, 5, 6, 8],
          line: 'last 8 weeks · read 12 Nov 09:00',
          firstFinished: undefined,
          skipped: undefined,
        },
      },
    })
    expect(await forecast()).toMatchObject({
      kind: 'forecast',
      pace: { source: 'tracker', tracker: 'GitHub', counts: [3, 5, 6, 4, 7, 5, 6, 8] },
      paceSaid: 'GitHub’s last 8 weeks',
    })
  })
})

describe('the window', () => {
  beforeEach(async () => {
    await connectGitHub()
  })

  /** Reads `tickets` as the milestone's finished tickets, then follows GitHub. */
  async function following(tickets: Ticket[], options?: { cadenceDays?: string }): Promise<void> {
    team.fixture.reads[CHECKOUT.query] = { tickets: [...OPEN, ...tickets], incomplete: false }
    await enterAndPick(options)
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  }

  test('it counts the 8 most recent whole periods, quiet ones 0, leaving out older ones and the current one', async () => {
    // 5-day sprints from 31 Aug: the read reaches back 7 weeks, to 24 Sep, so whole from the sprint of 25 Sep; the
    // current one, of 9 Nov, is left out
    const sprints = ['2026-09-30', '2026-10-05', '2026-10-10', '2026-10-15', '2026-10-20', '2026-10-25', '2026-10-30', '2026-11-04']
    const counts = [2, 3, 1, 0, 4, 2, 5, 3]
    await following(
      [
        ...finishedOn('older', '2026-09-26', 9),
        ...counts.flatMap((count, sprint) => finishedOn('s', sprints[sprint] ?? '', count)),
        ...finishedOn('current', '2026-11-10', 7),
      ],
      { cadenceDays: '5' },
    )

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      periods: sprints.map((start, sprint) => ({ start, count: counts[sprint], skipped: false })),
      counts,
      line: 'last 8 sprints · read 12 Nov 09:00',
      firstFinished: undefined,
    })
    expect(await forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', counts } })
  })

  test('quiet weeks before the first finished ticket are left out, and those after it count 0', async () => {
    await following(finishedInWeeks([0, 0, 0, 0, 2, 3, 0, 4]))

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      periods: [
        { start: '2026-10-12', count: 2, skipped: false },
        { start: '2026-10-19', count: 3, skipped: false },
        { start: '2026-10-26', count: 0, skipped: false },
        { start: '2026-11-02', count: 4, skipped: false },
      ],
      counts: [2, 3, 0, 4],
      line: '4 weeks · read 12 Nov 09:00',
      firstFinished: 'From the first finished ticket, 12 Oct.',
    })
    expect(await forecast()).toMatchObject({
      kind: 'forecast',
      pace: { source: 'tracker', counts: [2, 3, 0, 4] },
      warnings: expect.arrayContaining([{ input: 'pace', message: 'GitHub’s pace: 4 weeks. The forecast needs 8 to be reliable.' }]),
    })
    expect((await inputs()).milestone.notes).toContainEqual({ input: 'pace', message: '4 of 8 needed for reliable results' })
  })

  test('the first finished ticket is the first either read returns: comparable work’s quiet weeks after the milestone’s first finish count 0', async () => {
    const like: Choice = { kind: 'label', name: 'checkout-like', query: 'label:"checkout-like"' }
    team.fixture.milestoneChoices = [
      { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
      { kind: 'label', choices: [like], pastLimit: false },
    ]
    team.fixture.reads[like.query] = {
      tickets: finishedInWeeks([0, 0, 0, 0, 2, 3, 2, 3]).map((ticket) => ({ ...ticket, id: `like-${ticket.id}` })),
      incomplete: false,
    }
    await following(finishedInWeeks([0, 0, 1, 0, 0, 0, 0, 0]))
    await pick(team, READ_AT, like, 'comparableWork')

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [0, 0, 2, 3, 2, 3],
      line: '6 weeks · read 12 Nov 09:00',
      firstFinished: 'From the first finished ticket, 28 Sep.',
    })
  })

  test('a read reaching back less far than the window, as before a change of cadence, says where the tracker’s periods run out', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))

    // fortnightly sprints from 31 Aug: the weekly read, back to 10 Sep, reaches whole only those from 14 Sep
    await submit({ kind: 'setCadence', cadenceDays: '14' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [8, 10, 12, 14],
      line: '4 sprints · GitHub has nothing before the sprint of 14 Sep · read 12 Nov 09:00',
      firstFinished: undefined,
    })
  })

  test('the milestone’s own pace counts only the periods since its start date, and says so', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))

    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-05', ticketsRemaining: '30' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [4, 7, 5, 6, 8],
      line: '5 weeks · since the start date · read 12 Nov 09:00',
      firstFinished: undefined,
    })
  })

  test('fewer than 4 weeks stop the forecast, as typed counts do', async () => {
    await following(finishedInWeeks([0, 0, 0, 0, 0, 2, 0, 3]))

    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'pace', message: 'GitHub’s pace: 3 weeks. The forecast needs at least 4. Type counts, or switch pace to the range.' }],
    })
  })

  test('with nothing finished in the weeks read, there is no pace to follow', async () => {
    await following([])

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      periods: [],
      counts: [],
      line: 'nothing finished in the 8 weeks GitHub reads · read 12 Nov 09:00',
    })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'pace', message: expect.stringContaining('GitHub has no finished tickets in the weeks it read') }],
    })
  })

  test('the pace pattern reads GitHub’s counts as it reads typed counts', async () => {
    await following(finishedInWeeks([5, 5, 6, 4, 7, 5, 6, 8]))

    const view = await forecast()
    expect(view.kind === 'forecast' && view.pacePattern?.pattern).toBe('steady')
  })
})

describe('an incomplete read', () => {
  test('with no other read to take pace from, pace is marked incomplete, and the forecast doesn’t use part of a pace', async () => {
    await connectGitHub()
    team.fixture.reads[CHECKOUT.query] = { tickets: [...OPEN, ...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8])], incomplete: true }
    await enterAndPick()
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })

    expect((await inputs()).milestone.trackerPace).toMatchObject({ tracker: 'GitHub', reading: undefined, incomplete: true })
    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: expect.arrayContaining([
        {
          input: 'pace',
          message:
            'GitHub gave only part of the finished tickets its queries match, so its pace isn’t known. Narrow the query, or type counts, or switch pace to the range.',
        },
      ]),
    })
  })

  test('with a complete read, pace is not marked incomplete', async () => {
    await connectGitHub()
    await enterAndPick()

    expect((await inputs()).milestone.trackerPace).toMatchObject({ incomplete: false })
  })
})

describe('switching pace', () => {
  beforeEach(async () => {
    await connectGitHub()
    await enterAndPick()
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  })

  test('switching to the range and back keeps the typed counts', async () => {
    await submit({ kind: 'setPaceMode', paceMode: 'range' })
    expect(await forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'range', low: 4, high: 8 } })

    await submit({ kind: 'setPaceMode', paceMode: 'counts' })
    expect(await forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'counts', counts: [1, 2, 3, 4] } })

    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })
    expect((await inputs()).milestone).toMatchObject({ paceMode: 'tracker', paceCounts: [1, 2, 3, 4] })
  })

  test('typing into the opened weeks switches pace to the typed counts, as typed from GitHub’s', async () => {
    // the opened weeks start from GitHub’s counts
    expect((await inputs()).milestone.trackerPace?.reading?.counts).toEqual([3, 5, 6, 4, 7, 5, 6, 8])

    expect(await submit({ kind: 'setPaceCounts', counts: '3, 5, 6, 4, 7, 5, 6, 9' })).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'inputs' } })

    expect((await inputs()).milestone).toMatchObject({ paceMode: 'counts', paceCounts: [3, 5, 6, 4, 7, 5, 6, 9] })
    expect(await forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'counts', counts: [3, 5, 6, 4, 7, 5, 6, 9] } })
  })

  test('with no connection, pace falls back to the typed counts, and GitHub is not offered', async () => {
    expect(await forecast(OFFLINE)).toMatchObject({ kind: 'forecast', pace: { source: 'counts', counts: [1, 2, 3, 4] } })
    expect((await inputs(OFFLINE)).milestone).toMatchObject({ paceMode: 'tracker', paceUsed: 'counts', trackerPace: undefined })

    await submit({ kind: 'setPaceMode', paceMode: 'range' })
    expect(await submit({ kind: 'setPaceMode', paceMode: 'tracker' }, OFFLINE)).toMatchObject({
      kind: 'refused',
      view: { inputs: { refusal: { error: 'Choose the range or typed counts.' } } },
    })
  })
})

describe('the pace graph', () => {
  const like: Choice = { kind: 'label', name: 'checkout-like', query: 'label:"checkout-like"' }
  // the milestone started on Monday 5 Oct, so the weeks of 14, 21 and 28 Sep come before it
  const STARTED = '2026-10-05'
  const OWN = [5, 6, 4, 7, 5, 6, 8]
  const LIKE = [2, 3, 2, 3, 2, 3, 2]

  /** Follows GitHub, the milestone started on `STARTED`; with `comparable`, comparable work finished that many a week. */
  async function following(comparable: number[] | undefined): Promise<void> {
    await connectGitHub()
    team.fixture.milestoneChoices = [
      { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
      { kind: 'label', choices: [like], pastLimit: false },
    ]
    const likeTickets = finishedInWeeks(comparable ?? []).map((ticket) => ({ ...ticket, id: `like-${ticket.id}` }))
    team.fixture.reads[like.query] = { tickets: [{ id: 'like-open' }, ...likeTickets], incomplete: false }
    await enterAndPick()
    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: STARTED, ticketsRemaining: '30' })
    if (comparable) await pick(team, READ_AT, like, 'comparableWork')
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  }

  const trendOf = (view: Awaited<ReturnType<typeof forecast>>) => (view.kind === 'forecast' ? view.paceTrend : undefined)

  test('with comparable work, it pairs its finished tickets with the milestone’s own each week, marking the weeks before the milestone started and the series pace comes from', async () => {
    await following(LIKE)

    // the read reaches 8 whole weeks, from 14 Sep: comparable work finished nothing in the last
    const counts = [...LIKE, 0]
    const paired = { from: 'comparableWork', comparableWork: counts, milestone: [3, ...OWN], beforeStart: 3 }
    expect((await inputs()).milestone.paceTrend).toMatchObject({ counts, paired })
    expect(trendOf(await forecast())).toMatchObject({ counts, paired })
  })

  test('with no comparable-work query, it shows the milestone’s own alone', async () => {
    await following(undefined)

    expect((await inputs()).milestone.paceTrend).toMatchObject({ counts: [4, 7, 5, 6, 8], paired: undefined })
    expect(trendOf(await forecast())).toMatchObject({ counts: [4, 7, 5, 6, 8], paired: undefined })
  })

  test('with comparable work that finished nothing, pace falls back to the milestone’s own, paired with comparable work’s quiet weeks', async () => {
    await following([0, 0, 0, 0, 0, 0, 0])

    expect((await inputs()).milestone.paceTrend).toMatchObject({
      counts: [4, 7, 5, 6, 8],
      paired: { from: 'milestone', comparableWork: [0, 0, 0, 0, 0], milestone: [4, 7, 5, 6, 8], beforeStart: 0 },
    })
  })
})
