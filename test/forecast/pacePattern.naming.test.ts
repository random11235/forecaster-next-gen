import { describe, expect, test } from 'vitest'
import { forecast, submit, withTypedCounts } from './pacePatternScenario.js'

// The pattern the tool names from typed counts (#161), and when it names none.

describe('the pattern named from typed counts', () => {
  test('counts that vary a little and keep level are Steady, with their spread', async () => {
    const pattern = (await forecast(await withTypedCounts([5, 4, 6, 5, 5, 4, 6, 5, 5, 4]))).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steady',
      line: 'Steady · 4 to 6 a week',
      meaning: 'No sign the pace is changing. The forecast takes these weeks as they are.',
    })
    expect(pattern?.action).toBeUndefined()
  })

  test('a lasting rise is Stepped up, from the week it stepped, offering to count pace from there', async () => {
    // 14 weeks from 3 Aug: about 4 a week, then 8 from the week of 12 Oct.
    const pattern = (await forecast(await withTypedCounts([4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8]))).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steppedUp',
      line: 'Stepped up · about 4 a week, then 8 since 12 Oct',
      meaning: 'About 4 a week, then 8 since 12 Oct.',
      advice: "If that's lasting, count pace from 12 Oct.",
      action: { kind: 'startFrom', date: '2026-10-12', button: 'Start from 12 Oct' },
    })
  })

  test('a lasting fall is Stepped down, from the week it stepped', async () => {
    // 14 weeks from 3 Aug: about 8 a week, then 4 from the week of 21 Sep.
    const pattern = (await forecast(await withTypedCounts([8, 9, 7, 8, 9, 8, 9, 4, 3, 4, 4, 3, 5, 4]))).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'steppedDown',
      line: 'Stepped down · about 8 a week, then 4 since 21 Sep',
      action: { kind: 'startFrom', date: '2026-09-21', button: 'Start from 21 Sep' },
    })
  })

  test('a steady climb is Speeding up, with advice not to extend it and no action', async () => {
    const pattern = (await forecast(await withTypedCounts([2, 2, 1, 3, 2, 2, 2, 3, 3, 4, 5, 5, 6, 7]))).pacePattern

    expect(pattern).toEqual({
      pattern: 'speedingUp',
      line: 'Speeding up · from about 2 to about 5 a week',
      meaning: 'From about 2 a week in the first 7 weeks to about 5 in the last 7.',
      advice: "Don't extend the trend: the forecast draws from all 14 weeks, so if it goes on, the dates will move sooner as new weeks are read.",
    })
  })

  test('a steady decline is Slowing down', async () => {
    const pattern = (await forecast(await withTypedCounts([8, 9, 8, 7, 8, 8, 8, 7, 7, 6, 5, 5, 4, 3]))).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'slowingDown',
      line: 'Slowing down · from about 8 to about 5 a week',
      advice: "Don't extend the trend: the forecast draws from all 14 weeks, so if it goes on, the dates will move later as new weeks are read.",
    })
  })

  test('busy weeks and quiet weeks in runs are Good and bad spells, warning the range may be too narrow', async () => {
    const pattern = (await forecast(await withTypedCounts([5, 5, 4, 5, 6, 5, 3, 2, 3, 8, 9, 8, 2, 3]))).pacePattern

    expect(pattern).toEqual({
      pattern: 'goodAndBadSpells',
      line: 'Good and bad spells · 2 to 9 a week',
      meaning: 'Busy weeks come together and so do quiet ones: 2 to 9 a week, in runs.',
      advice: 'The range may be too narrow, since quiet weeks come in runs. Hold the dates loosely.',
    })
  })

  test('counts that vary far more than their level are Lumpy, advising to keep every week', async () => {
    const pattern = (await forecast(await withTypedCounts([3, 0, 8, 1, 0, 9, 0, 9, 1, 0, 8, 2, 0, 10]))).pacePattern

    expect(pattern).toEqual({
      pattern: 'lumpy',
      line: 'Lumpy · 0 to 10 a week',
      meaning: 'Work finishes in batches, 0 to 10 a week, so the range is wide because the pace really varies.',
      advice:
        "Keep every week, zeros included, and accept the wide range. To narrow it, split work smaller, finish before starting, and close tickets as soon as they're done.",
    })
  })

  test('one week far above the rest is One odd week, named, offering to leave it out', async () => {
    // 14 weeks from 3 Aug: the week of 12 Oct finished 23.
    const pattern = (await forecast(await withTypedCounts([5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4]))).pacePattern

    expect(pattern).toMatchObject({
      pattern: 'oneOddPeriod',
      line: 'One odd week · 12 Oct finished 23',
      meaning: 'The week of 12 Oct finished 23, against 4 to 6 in the other weeks.',
      advice: "If that week wasn't like the others, leave it out of the pace.",
      action: { kind: 'leaveOut', period: '2026-10-12', button: 'Leave out 12 Oct' },
    })
  })
})

describe('from 6 to 9 periods', () => {
  // Eight weeks from 14 Sep.
  test('a changing pattern is worded as early', async () => {
    expect((await forecast(await withTypedCounts([2, 2, 3, 3, 4, 5, 6, 7]))).pacePattern).toMatchObject({
      pattern: 'speedingUp',
      line: 'May be speeding up: too early to be sure.',
    })
  })

  test('an early step still offers its action', async () => {
    expect((await forecast(await withTypedCounts([4, 3, 4, 5, 8, 9, 7, 8]))).pacePattern).toMatchObject({
      pattern: 'steppedUp',
      line: 'May have stepped up: too early to be sure.',
      meaning: 'About 4 a week, then 8 since 12 Oct.',
      action: { kind: 'startFrom', date: '2026-10-12' },
    })
  })

  test('Steady and One odd week are not worded as early', async () => {
    expect((await forecast(await withTypedCounts([5, 4, 6, 5, 5, 4, 6, 5]))).pacePattern?.line).toBe('Steady · 4 to 6 a week')
    expect((await forecast(await withTypedCounts([5, 6, 5, 4, 23, 5, 6, 4]))).pacePattern?.line).toBe('One odd week · 12 Oct finished 23')
  })
})

describe('when no pattern is named', () => {
  test('fewer than 6 periods say only that it is too early', async () => {
    expect((await forecast(await withTypedCounts([5, 4, 6, 5, 5]))).pacePattern).toEqual({
      pattern: undefined,
      line: 'No pattern yet · 5 weeks is too few to tell',
    })
  })

  test('a window with nothing finished is never Steady', async () => {
    expect((await forecast(await withTypedCounts([0, 0, 0, 0, 0, 0, 0, 0]))).pacePattern).toEqual({
      pattern: undefined,
      line: 'Nothing finished in these 8 weeks: no pattern to read.',
    })
  })

  test('quiet periods before the first finished ticket are not read', async () => {
    expect((await forecast(await withTypedCounts([0, 0, 0, 5, 4, 6, 5, 5]))).pacePattern).toEqual({
      pattern: undefined,
      line: 'No pattern yet · 5 weeks is too few to tell',
    })
  })

  test('a cadence under 7 days is too short to read', async () => {
    expect((await forecast(await withTypedCounts([1, 0, 1, 1, 0, 1, 1, 0, 1, 1], 1))).pacePattern).toEqual({
      pattern: undefined,
      line: 'Patterns are read from weeks or sprints.',
    })
  })

  test('a pace range has no counts to read', async () => {
    const team = await withTypedCounts([5, 4, 6, 5, 5, 4, 6, 5, 5, 4])
    await submit(team, { kind: 'setPaceRange', low: '4', high: '6' })
    await submit(team, { kind: 'setPaceMode', paceMode: 'range' })

    expect((await forecast(team)).pacePattern).toBeUndefined()
  })
})
