import { describe, expect, test } from 'vitest'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openStorage, useTempDatabase } from '../tempDatabase.js'
import { TEAM, TODAY, forecast, submit, withTypedCounts } from './pacePatternScenario.js'

// A pattern's forecast action (#161): the 85% date it offers both ways, and the action applied and undone.

useTempDatabase('forecaster-pace-pattern-')

/** The 85% date of the milestone forecast from these typed counts, in a fresh file. */
function dateAt85(counts: readonly number[]): string | null | undefined {
  return forecast(withTypedCounts(counts)).dates.find(({ percent }) => percent === 85)?.date
}

describe("an action's 85% date, with and without it", () => {
  test('counting pace from the step gives the date the counts since the step give', () => {
    const applied = dateAt85([8, 9, 7, 8])
    const now = dateAt85([4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8])
    const action = forecast(withTypedCounts([4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8])).pacePattern?.action

    expect(action?.dates).toEqual({ percent: 85, now, applied })
    expect(applied && now && applied < now).toBe(true)
  })

  test('leaving out the odd week gives the date the other weeks give', () => {
    const applied = dateAt85([5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 5, 6, 4])
    const counts = [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4]
    const now = dateAt85(counts)
    const action = forecast(withTypedCounts(counts)).pacePattern?.action

    expect(action?.dates).toEqual({ percent: 85, now, applied })
    expect(applied && now && applied > now).toBe(true)
  })
})

const STEPPED_UP = [4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8]
const ODD_WEEK = [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4]

describe('an applied action', () => {
  test('counting pace from the step forecasts from the counts since, saying so', () => {
    const storage = withTypedCounts(STEPPED_UP)
    const offered = forecast(storage).pacePattern?.action

    expect(submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })).toEqual({ saved: true, next: 'forecast' })

    const view = forecast(storage)
    expect(view.pace).toEqual({ source: 'counts', counts: [8, 9, 7, 8] })
    expect(view.paceTrend?.counts).toEqual([8, 9, 7, 8])
    expect(view.dates.find(({ percent }) => percent === 85)?.date).toBe(offered?.dates.applied)
    expect(view.pacePattern).toEqual({
      pattern: undefined,
      line: 'No pattern yet · 4 weeks is too few to tell',
      applied: 'Counting pace from 12 Oct, after it stepped up.',
    })
  })

  test('undo brings every count back, and the pattern and its action with them', () => {
    const storage = withTypedCounts(STEPPED_UP)
    submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })

    expect(submit(storage, { kind: 'undoPaceAction' })).toEqual({ saved: true, next: 'forecast' })

    const view = forecast(storage)
    expect(view.pace).toEqual({ source: 'counts', counts: STEPPED_UP })
    expect(view.pacePattern).toMatchObject({ pattern: 'steppedUp', action: { kind: 'startFrom', date: '2026-10-12' } })
    expect(view.pacePattern?.applied).toBeUndefined()
  })

  test('leaving out the odd week reads the other weeks again, naming the week left out, with no action offered', () => {
    const storage = withTypedCounts(ODD_WEEK)

    submit(storage, { kind: 'applyPaceAction', action: 'leaveOut', period: '2026-10-12' })

    const view = forecast(storage)
    expect(view.pace).toEqual({ source: 'counts', counts: [5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 5, 6, 4] })
    expect(view.pacePattern).toEqual({
      pattern: 'steady',
      line: 'Steady · 4 to 6 a week',
      meaning: 'No sign the pace is changing. The forecast takes these weeks as they are.',
      applied: 'Leaving out the week of 12 Oct, the odd week.',
    })
  })

  test('an applied action belongs to the milestone, so it outlasts reopening the file', () => {
    submit(withTypedCounts(STEPPED_UP), { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })

    expect(forecast(openStorage()).pacePattern?.applied).toBe('Counting pace from 12 Oct, after it stepped up.')
  })

  test('an action that is not one is refused, saying why, and nothing changes', () => {
    const storage = withTypedCounts(STEPPED_UP)

    const submitted = submit(storage, { kind: 'applyPaceAction', action: 'skipAll', date: '2026-10-12' })

    expect(submitted).toMatchObject({ saved: false, screen: 'forecast', view: { paceActionRefusal: 'That action is no longer offered.' } })
    expect(forecast(storage).pace).toEqual({ source: 'counts', counts: STEPPED_UP })
  })

  test('refused with no pattern to show it on, the forecast still says why', () => {
    const storage = withTypedCounts(STEPPED_UP)
    submit(storage, { kind: 'setPaceRange', low: '4', high: '6' })
    submit(storage, { kind: 'setPaceMode', paceMode: 'range' })

    const submitted = submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: 'soon' })

    expect(submitted).toMatchObject({
      saved: false,
      screen: 'forecast',
      view: { pacePattern: undefined, paceActionRefusal: 'That action is no longer offered.' },
    })
  })

  test('is still offered when it would leave fewer counts than the forecast needs', () => {
    // Eight weeks from 14 Sep: about 4 a week, then 9 from 19 Oct, three weeks ago.
    const pattern = forecast(withTypedCounts([4, 3, 4, 5, 4, 9, 8, 9])).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steppedUp',
      meaning: 'About 4 a week, then 9 since 19 Oct.',
      advice: "If that's lasting, count pace from 19 Oct.",
      action: { kind: 'startFrom', date: '2026-10-19', button: 'Start from 19 Oct' },
    })
  })

  test('applied, leaving fewer counts than the forecast needs, gets the too-few-counts problem, with the action said and undo', () => {
    const storage = withTypedCounts([4, 3, 4, 5, 4, 9, 8, 9])

    expect(submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-19' })).toEqual({ saved: true, next: 'forecast' })

    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)).toEqual({
      kind: 'problems',
      name: 'Launch',
      problems: [
        {
          input: 'typedCounts',
          message: 'Counting pace from 19 Oct leaves 3 weeks. The forecast needs at least 4. Add another count, or switch pace to the range.',
        },
      ],
      paceApplied: 'Counting pace from 19 Oct, after it stepped up.',
    })
    submit(storage, { kind: 'undoPaceAction' })
    expect(forecast(storage).pace).toEqual({ source: 'counts', counts: [4, 3, 4, 5, 4, 9, 8, 9] })
  })

  test('leaving fewer counts than are reliable warns of the window, not of the counts typed', () => {
    const storage = withTypedCounts(STEPPED_UP)

    submit(storage, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })

    expect(forecast(storage).warnings).toContainEqual({
      input: 'typedCounts',
      message: 'Counting pace from 12 Oct leaves 4 weeks. The forecast needs 8 to be reliable.',
    })
  })
})
