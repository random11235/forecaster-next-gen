import { beforeEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { finishedOn } from '../trackerScenario.js'
import { CHECKOUT, pick } from './forecastingForTest.js'
import { finishedInWeeks, OFFLINE, OPEN, READ_AT, trackerPaceScenario } from './trackerPaceScenario.js'

// Pace following the tracker (#212): up to the 8 most recent whole periods it reads, the current one left out, quiet
// ones 0, leaving out quiet periods before the first finished ticket. Arranged through trackerPaceScenario.ts.

const scenario = trackerPaceScenario()
const { submit, inputs, forecast, connectGitHub, enterAndPick } = scenario

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
    scenario.team.fixture.reads[CHECKOUT.query] = { tickets: [...OPEN, ...tickets], incomplete: false }
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

  test('at a 3-day cadence changed from 7, Inputs shows the 3-day counts the forecast draws from', async () => {
    await enterAndPick()
    await submit({ kind: 'setCadence', cadenceDays: '3' })
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })

    const { milestone } = await inputs()
    expect(milestone).toMatchObject({ cadenceDays: 3, period: 'sprint', paceUsed: 'tracker' })
    expect(milestone.notes.filter(({ input }) => input === 'pace')).toEqual([])
    // 3-day sprints from 31 Aug: the last 8 whole ones before the current sprint of 11 Nov, the weeks' Tuesday finishes
    // of 20 Oct, 27 Oct and 3 Nov each in one, the typed counts not among them
    const sprints = ['2026-10-18', '2026-10-21', '2026-10-24', '2026-10-27', '2026-10-30', '2026-11-02', '2026-11-05', '2026-11-08']
    const counts = [5, 0, 0, 6, 0, 8, 0, 0]
    expect(milestone.trackerPace?.reading).toMatchObject({
      periods: sprints.map((start, sprint) => ({ start, count: counts[sprint], skipped: false })),
      counts,
      line: 'last 8 sprints · read 12 Nov 09:00',
    })
    const forecastShown = await forecast()
    expect(forecastShown).toMatchObject({ kind: 'forecast', cadenceDays: 3, pace: { source: 'tracker', counts } })
    if (forecastShown.kind !== 'forecast') throw new Error('expected a forecast')
    expect(forecastShown.warnings.filter(({ input }) => input === 'pace')).toEqual([])
  })

  test('the current period, left out until it ends, is named with the tickets finished in it so far (#390)', async () => {
    // finished on Tuesday 10 Nov, in the current week of 9 Nov, before the read at 09:00 on Thursday 12 Nov
    await following([...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]), ...finishedOn('current', '2026-11-10', 2)])

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [3, 5, 6, 4, 7, 5, 6, 8],
      current: 'This week, from 9 Nov, counts once it ends: 2 finished so far.',
    })
  })

  test('read before the current week began, the week the read saw only part of isn’t counted until read again (#390)', async () => {
    await following([...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]), ...finishedOn('read', '2026-11-10', 2)])

    // Tuesday 17 Nov: the week of 9 Nov has ended since the read, on Thursday 12 Nov, which saw only its first days
    scenario.team.at('2026-11-17T09:00:00Z')

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [3, 5, 6, 4, 7, 5, 6, 8],
      line: 'last 8 weeks · read 12 Nov 09:00',
      current: 'This week, from 16 Nov, counts once it ends. The week of 9 Nov counts once read again: the last read, on 12 Nov, came before it ended.',
    })
    expect(await forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', counts: [3, 5, 6, 4, 7, 5, 6, 8] } })
  })

  test('the window ends at the older of the two reads, and the line says so, though pace comes from the newer (#390)', async () => {
    const like: Choice = { kind: 'label', name: 'checkout-like', query: 'label:"checkout-like"' }
    scenario.team.fixture.milestoneChoices = [
      { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
      { kind: 'label', choices: [like], pastLimit: false },
    ]
    scenario.team.fixture.reads[like.query] = {
      tickets: [...finishedInWeeks([2, 3, 2, 3, 2, 3, 2, 3]), ...finishedOn('since', '2026-11-10', 4)].map((ticket) => ({
        ...ticket,
        id: `like-${ticket.id}`,
      })),
      incomplete: false,
    }
    // the milestone read on Thursday 12 Nov; comparable work, which pace comes from, on Tuesday 17 Nov
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))
    scenario.team.at('2026-11-17T09:00:00Z')
    await pick(scenario.team, '2026-11-17T09:00:00Z', like, 'comparableWork')

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      // comparable work's read, on 17 Nov, reaches whole from w/c 21 Sep; the milestone's, on 12 Nov, up to w/c 2 Nov
      counts: [3, 2, 3, 2, 3, 2, 3],
      current: 'This week, from 16 Nov, counts once it ends. The week of 9 Nov counts once read again: the last read, on 12 Nov, came before it ended.',
    })
  })

  test('read sprints ago, the sprints since the read wait for it too', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]), { cadenceDays: '14' })

    // Thursday 10 Dec: the sprints of 9 and 23 Nov have ended since the read on 12 Nov, and that of 7 Dec is the current one
    scenario.team.at('2026-12-10T09:00:00Z')

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [8, 10, 12, 14],
      current: 'This sprint, from 7 Dec, counts once it ends. The sprints from 9 Nov count once read again: the last read, on 12 Nov, came before they ended.',
    })
  })

  test('with nothing finished yet in the current sprint, it says so', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]), { cadenceDays: '14' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      current: 'This sprint, from 9 Nov, counts once it ends: none finished so far.',
    })
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
    scenario.team.fixture.milestoneChoices = [
      { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
      { kind: 'label', choices: [like], pastLimit: false },
    ]
    scenario.team.fixture.reads[like.query] = {
      tickets: finishedInWeeks([0, 0, 0, 0, 2, 3, 2, 3]).map((ticket) => ({ ...ticket, id: `like-${ticket.id}` })),
      incomplete: false,
    }
    await following(finishedInWeeks([0, 0, 1, 0, 0, 0, 0, 0]))
    await pick(scenario.team, READ_AT, like, 'comparableWork')

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [0, 0, 2, 3, 2, 3],
      line: '6 weeks · read 12 Nov 09:00',
      firstFinished: 'From the first finished ticket, 28 Sep.',
    })
  })

  test('a change of cadence reads GitHub as far back as the new periods need (#415)', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))
    // two finished in the sprint of 31 Aug, before the weekly read's reach, back to Thursday 10 Sep
    scenario.team.fixture.reads[CHECKOUT.query] = {
      tickets: [...OPEN, ...finishedOn('early', '2026-09-01', 1), ...finishedOn('earlier', '2026-09-08', 1), ...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8])],
      incomplete: false,
    }
    scenario.team.calls.since.splice(0)

    // fortnightly sprints from 31 Aug: 9 sprints back from Thursday 12 Nov, 18 weeks
    await submit({ kind: 'setCadence', cadenceDays: '14' })

    expect(scenario.team.calls.since).toEqual(['2026-07-09T09:00:00.000Z'])
    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [2, 8, 10, 12, 14],
      line: '5 sprints · since the start date · read 12 Nov 09:00',
    })
  })

  test('a change of cadence GitHub can’t be read further back for says how far the read reaches (#415)', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))
    scenario.team.fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    // fortnightly sprints from 31 Aug: the weekly read, back to 10 Sep, reaches whole only those from 14 Sep
    await submit({ kind: 'setCadence', cadenceDays: '14' })

    expect((await inputs()).milestone.trackerPace?.reading).toMatchObject({
      counts: [8, 10, 12, 14],
      line: '4 sprints · the read reaches back to the sprint of 14 Sep · read 12 Nov 09:00',
      firstFinished: undefined,
    })
  })

  test('too few periods for the read’s reach offer to read GitHub again, which reaches back as far as they need (#415)', async () => {
    await following(finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8]))
    scenario.team.fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    // 28-day sprints from 31 Aug: the weekly read, back to 10 Sep, reaches whole only the one of 28 Sep
    await submit({ kind: 'setCadence', cadenceDays: '28' })

    expect(await forecast()).toMatchObject({
      kind: 'problems',
      problems: [
        {
          input: 'pace',
          message:
            'GitHub’s pace: 1 sprint · the read reaches back to the sprint of 28 Sep. The forecast needs at least 4. Read again to reach further back, type counts, or switch pace to the range.',
        },
      ],
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
    scenario.team.fixture.reads[CHECKOUT.query] = { tickets: [...OPEN, ...finishedInWeeks([3, 5, 6, 4, 7, 5, 6, 8])], incomplete: true }
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
