import { describe, expect, test } from 'vitest'
import type { ForecastingForTest } from './forecastingForTest.js'
import { submitInputs } from './forecastingForTest.js'
import { MONDAY, newTeam, tenTicketsAtFive, add, view, headline, shownAgain, withoutCapacity } from './capacityScenario.js'

// Capacity (#153, #164): the EM types the team's capacity beside the forecast, and each period's pace is scaled by it.
// Arranged through capacityScenario.ts.

describe('typing capacity', () => {
  test('a week at 0% finishes nothing that week, so the headline moves a week later, and the forecast screen comes next', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    expect(await headline(team)).toBe('2026-09-21')

    expect(await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'forecast' } })

    expect(await headline(team)).toBe('2026-09-28')
  })

  test('a holiday Monday leaves the week at 80%, as weekends do not count', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, '0', '2026-09-07', '', { note: 'Holiday' })

    // 4 that week, then 5 and 5: done in the third
    expect(await headline(team)).toBe('2026-09-28')
  })

  test('a day off at the weekend changes nothing', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, '0', '2026-09-12', '2026-09-13')

    expect(await headline(team)).toBe('2026-09-21')
  })

  test('a sprint cadence averages capacity over the sprint’s ten working days', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team, { cadenceDays: '14' })
    expect(await headline(team)).toBe('2026-10-05')

    // half the first sprint off: 2.5 that sprint, so a third sprint is needed
    await add(team, '0', '2026-09-07', '2026-09-11')

    expect(await headline(team)).toBe('2026-10-19')
  })

  test('overlapping entries multiply: 50% of 50% is a quarter of the usual pace', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, '50', MONDAY, '', { onward: true, note: 'KTLO' })
    await add(team, '50', MONDAY, '', { onward: true, note: 'Half on leave' })

    // 1.25 a week: done in the eighth week
    expect(await headline(team)).toBe('2026-11-02')
  })

  test('capacity before the start date does not touch the forecast', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    const before = await view(team)

    await add(team, '0', '2026-08-24', '2026-09-04')

    expect(withoutCapacity(await view(team))).toEqual(withoutCapacity(before))
  })

  test('the past counts typed for the pace are not adjusted for capacity', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await submitInputs(team, { kind: 'setPaceCounts', counts: '5 5 5 5 5 5' })
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'counts' })
    expect(await headline(team)).toBe('2026-09-21')

    // a week in the past at 0% doesn't make those counts mean a faster team
    await add(team, '0', '2026-08-03', '2026-08-07')

    expect(await headline(team)).toBe('2026-09-21')
  })

  test('with no entries, the section lists none, its form is blank, and the forecast is as it was', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    const forecast = await view(team)

    expect(forecast.kind === 'forecast' && forecast.capacity).toEqual({
      on: true,
      open: false,
      summary: 'none, every week usual',
      entries: [],
      past: [],
      form: { percent: '', from: '', to: '', onward: false, note: '' },
    })
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBeUndefined()
  })

  test('the entries are listed earliest first, an empty end being the one day it starts', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, '60', '2026-10-05', '', { onward: true, note: 'Two leave' })
    await add(team, '0', '2026-09-14', '', { note: 'Holiday' })

    const forecast = await view(team)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries).toEqual([
      { id: 2, from: '2026-09-14', to: '2026-09-14', percent: 0, note: 'Holiday' },
      { id: 1, from: '2026-10-05', to: undefined, percent: 60, note: 'Two leave' },
    ])
  })

  test('removing an entry takes it out of the forecast', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11')

    expect(await submitInputs(team, { kind: 'removeCapacity', id: '1' })).toEqual({ kind: 'saved', next: { kind: 'screen', screen: 'forecast' } })

    expect(await headline(team)).toBe('2026-09-21')
    const forecast = await view(team)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries).toEqual([])
  })

  test('an entry far above usual is warned of: the pace comes from a much smaller team', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, '150', MONDAY, '', { onward: true })
    await add(team, '300', '2026-12-01', '', { onward: true })

    const forecast = await view(team)
    const entries = forecast.kind === 'forecast' ? forecast.capacity.entries : []
    expect(entries.map(({ warning }) => warning)).toEqual([
      undefined,
      'At 300%, the pace comes from a team about 33% this size, so it’s a weak guide. A pace range may be better.',
    ])
  })
})

describe('the comparison', () => {
  test('with capacity in use, each date is given with capacity and at usual capacity, and the shift in periods between them', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const forecast = await view(team)
    expect(forecast.kind === 'forecast' && forecast.comparison).toEqual([
      { percent: 50, withCapacity: '2026-09-28', atUsual: '2026-09-21', shift: { periods: 1, words: '1 week later' } },
      { percent: 85, withCapacity: '2026-09-28', atUsual: '2026-09-21', shift: { periods: 1, words: '1 week later' } },
      { percent: 95, withCapacity: '2026-09-28', atUsual: '2026-09-21', shift: { periods: 1, words: '1 week later' } },
    ])
  })

  test('both forecasts use the same draws, so capacity after every trial has finished leaves each date where it was', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await submitInputs(team, { kind: 'setPaceRange', low: '2', high: '9' })

    await add(team, '120', '2027-06-01', '', { onward: true })

    const forecast = await view(team)
    const comparison = forecast.kind === 'forecast' ? forecast.comparison : undefined
    expect(comparison?.map(({ shift }) => shift.periods)).toEqual([0, 0, 0])
    expect(comparison?.map(({ withCapacity }) => withCapacity)).toEqual(comparison?.map(({ atUsual }) => atUsual))
  })

  test.each([
    ['later', '0', MONDAY, '2026-09-11', 'Includes capacity, which moves the 85% date 1 week later.', '1 entry · 85% date 1 week later'],
    ['sooner', '200', MONDAY, '', 'Includes capacity, which moves the 85% date 1 week sooner.', '1 entry · 85% date 1 week sooner'],
    ['not at all', '120', '2027-06-01', '', 'Includes capacity, which doesn’t move the 85% date.', '1 entry'],
  ])('capacity moving the 85%% date %s says so under the headline and in the folded summary', async (_, percent, from, to, line, summary) => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    await add(team, percent, from, to, { onward: to === '' })

    const forecast = await view(team)
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBe(line)
    expect(forecast.kind === 'forecast' && forecast.capacity.summary).toBe(summary)
  })

  test('the shift is in the team’s periods: a sprint later', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team, { cadenceDays: '14' })

    await add(team, '0', '2026-09-07', '2026-09-11')
    await add(team, '0', '2026-09-21', '2026-09-25')

    const forecast = await view(team)
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBe('Includes capacity, which moves the 85% date 1 sprint later.')
    expect(forecast.kind === 'forecast' && forecast.capacity.summary).toBe('2 entries · 85% date 1 sprint later')
  })

  test('with no capacity in use there is nothing to compare', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)

    const forecast = await view(team)

    expect(forecast.kind === 'forecast' && forecast.comparison).toBeUndefined()
  })
})

describe('each entry’s effect', () => {
  /** The forecast with the Capacity section open, as the EM sees it beside the entries. */
  function opened(team: ForecastingForTest) {
    return team.milestoneForecastView({ capacityOpen: true })
  }

  test('with the section open, each entry gives its own shift of the 85% date, from a run without it on the same draws', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    await add(team, '120', '2027-06-01', '', { onward: true })

    const forecast = await opened(team)

    expect(forecast.kind === 'forecast' && forecast.capacity.open).toBe(true)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ note, effect }) => [note, effect])).toEqual([
      ['Offsite', { periods: 1, words: '85% date +1 wk' }],
      ['', { periods: 0, words: 'no change to the 85% date' }],
    ])
  })

  test('an entry that brings the 85% date sooner says so, in the team’s periods', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team, { cadenceDays: '14' })
    await add(team, '200', MONDAY, '', { onward: true })

    const forecast = await opened(team)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries[0]?.effect).toEqual({ periods: -1, words: '85% date −1 sprint' })
  })

  test('an entry beyond the horizon, the only one, gives no change to the 85% date', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '50', '2031-01-06', '2031-01-10', { note: 'Far off' })

    const forecast = await opened(team)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries[0]?.effect).toEqual({ periods: 0, words: 'no change to the 85% date' })
  })

  test('an entry pushing the 85% date past the horizon says so, and the line under the headline gives no shift', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '1', MONDAY, '', { onward: true, note: 'Skeleton crew' })

    const forecast = await opened(team)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries[0]?.effect).toEqual({ periods: null, words: '85% date later than the horizon' })
    expect(forecast.kind === 'forecast' && forecast.capacityLine).toBe('Includes capacity.')
  })

  test('with the section folded, no entry gives its effect', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const forecast = await view(team)

    expect(forecast.kind === 'forecast' && forecast.capacity.open).toBe(false)
    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ effect }) => effect)).toEqual([undefined])
  })

  test('switched off, the section open, no entry gives its effect', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })
    await submitInputs(team, { kind: 'switchCapacity', on: false })

    const forecast = await opened(team)

    expect(forecast.kind === 'forecast' && forecast.capacity.entries.map(({ effect }) => effect)).toEqual([undefined])
  })

  test('opening the section changes nothing else on the screen', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    expect(withoutCapacity(await opened(team))).toEqual(withoutCapacity(await view(team)))
  })

  test('a refused entry shows the section open, with each entry’s effect when it was open', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const result = await submitInputs(team, { kind: 'addCapacity', percent: 'half', from: MONDAY, to: '', onward: false, note: '' }, { capacityOpen: true })

    const shown = shownAgain(result)
    expect(shown?.kind === 'forecast' && shown.capacity.open).toBe(true)
    expect(shown?.kind === 'forecast' && shown.capacity.entries[0]?.effect).toEqual({ periods: 1, words: '85% date +1 wk' })
  })
})

describe('a refusal from the folded section', () => {
  test('shows the section open to say why, without working out the effects', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '0', '2026-09-07', '2026-09-11', { note: 'Offsite' })

    const result = await add(team, 'half', MONDAY, '')

    const shown = shownAgain(result)
    expect(shown?.kind === 'forecast' && shown.capacity.open).toBe(true)
    expect(shown?.kind === 'forecast' && shown.capacity.entries[0]?.effect).toBeUndefined()
  })
})
