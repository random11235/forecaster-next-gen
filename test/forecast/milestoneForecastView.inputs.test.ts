import { describe, expect, test } from 'vitest'
import type { InputsEdit } from '../../src/forecast/inputs.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { Storage } from '../../src/storage/storage.js'
import { TEAM, TODAY, openStorage, newTeam, edit, enter, DATES_FROM_1_SEP, view, inputsScreenView } from './forecastViewScenario.js'

// Seam B: the Inputs screen before a forecast, its refusals, and the milestone and its ambiguity there. Arranged
// through forecastViewScenario.ts.

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
      paceWindow: { action: undefined, skippedPeriods: [] },
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
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
      paceWindow: { action: undefined, skippedPeriods: [] },
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
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
      paceUsed: 'range',
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
      paceWindow: { action: undefined, skippedPeriods: [] },
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
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
      paceUsed: 'range',
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

describe("the milestone's ambiguity", () => {
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
