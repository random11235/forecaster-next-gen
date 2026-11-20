import { describe, expect, test } from 'vitest'
import type { CapacityView, InputsEdit } from '../../src/forecast/index.js'
import { forecastingForTest, type ForecastingForTest } from './forecastingForTest.js'

// New usual (#153, #169): once every period the pace comes from falls after a lasting change, the pace already shows
// it, so the tool proposes ending it rather than counting it twice.

/** A Wednesday, in the second week from the start date. */
const TODAY = '2026-11-11'
/**
 * A Monday. Typed counts are dated back from the current period (from 9 Nov), the last being the most recent whole
 * one: four counts are the weeks from 12, 19 and 26 Oct and 2 Nov.
 */
const START = '2026-11-02'

/** The team's handle, the browser build's, on TODAY. */
const newTeam = () => forecastingForTest({ browser: true, clock: { now: `${TODAY}T09:00:00Z` } })

/** 20 tickets, in weeks from 2 Nov, at four typed counts. */
async function withTypedCounts(team: ForecastingForTest): Promise<void> {
  await submit(team, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '20' })
  await submit(team, { kind: 'setPaceCounts', counts: '4, 5, 4, 5' })
  await submit(team, { kind: 'setPaceMode', paceMode: 'counts' })
}

async function withPaceRange(team: ForecastingForTest): Promise<void> {
  await submit(team, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '20' })
  await submit(team, { kind: 'setPaceRange', low: '4', high: '5' })
}

const submit = (team: ForecastingForTest, edit: InputsEdit) => team.submit({ form: 'inputs', edit })

async function onward(team: ForecastingForTest, percent: string, from: string): Promise<void> {
  await submit(team, { kind: 'addCapacity', percent, from, to: '', onward: true, note: 'Two left' })
}

/** Refused on the Milestone forecast screen, its Capacity section saying `refusal`. */
const refusedOnForecast = (refusal: string) => ({ saved: false, screen: 'forecast', view: { kind: 'forecast', capacity: { refusal } } })

async function capacity(team: ForecastingForTest): Promise<CapacityView> {
  const view = await team.milestoneForecastView()
  if (view.kind !== 'forecast') throw new Error(`no forecast: ${view.kind}`)
  return view.capacity
}

describe('with typed counts', () => {
  test('while only some of the weeks the pace comes from are after a lasting change, it says how many', async () => {
    const team = await newTeam()
    await withTypedCounts(team)
    await onward(team, '80', '2026-10-19')

    expect((await capacity(team)).entries[0]?.newUsual).toEqual({ kind: 'counting', after: 3, of: 4, ofSaid: '4 weeks' })
  })

  test('a change that starts mid-week counts only the weeks that start on or after it', async () => {
    const team = await newTeam()
    await withTypedCounts(team)
    await onward(team, '80', '2026-10-20')

    expect((await capacity(team)).entries[0]?.newUsual).toEqual({ kind: 'counting', after: 2, of: 4, ofSaid: '4 weeks' })
  })

  test('once every week the pace comes from is after it, the change is proposed as the new usual', async () => {
    const team = await newTeam()
    await withTypedCounts(team)
    await onward(team, '80', '2026-10-12')

    expect((await capacity(team)).entries[0]?.newUsual).toEqual({ kind: 'proposed' })
  })

  test('a change with an end, or one still to start, has no new-usual line', async () => {
    const team = await newTeam()
    await withTypedCounts(team)
    await submit(team, { kind: 'addCapacity', percent: '80', from: '2026-10-12', to: '2026-12-31', onward: false, note: '' })
    await onward(team, '120', '2026-12-01')

    expect((await capacity(team)).entries.map(({ newUsual }) => newUsual)).toEqual([undefined, undefined])
  })

  test('accepting ends the change today, records the accept and moves it to Past, so it is no longer counted', async () => {
    const team = await newTeam()
    await withTypedCounts(team)
    await onward(team, '80', '2026-10-12')

    const accepted = await submit(team, { kind: 'acceptNewUsual', id: '1' })

    expect(accepted).toEqual({ saved: true, next: { screen: 'forecast' } })
    const { entries, past } = await capacity(team)
    expect(entries).toEqual([])
    expect(past).toEqual([{ id: 1, from: '2026-10-12', to: TODAY, percent: 80, note: 'Two left', newUsualOn: TODAY }])
  })

  test('keeping it stops the proposal, and the change still counts', async () => {
    const team = await newTeam()
    await withTypedCounts(team)
    await onward(team, '80', '2026-10-12')

    const kept = await submit(team, { kind: 'keepCapacity', id: '1' })

    expect(kept).toEqual({ saved: true, next: { screen: 'forecast' } })
    const [entry] = (await capacity(team)).entries
    expect(entry?.newUsual).toBeUndefined()
    expect(entry?.kept).toBe(true)
  })
})

describe('with a pace range', () => {
  test('there is no proposal: a lasting change that has started offers End it today', async () => {
    const team = await newTeam()
    await withPaceRange(team)
    await onward(team, '80', '2026-10-12')
    await onward(team, '120', '2026-12-01')

    expect((await capacity(team)).entries.map(({ newUsual }) => newUsual)).toEqual([{ kind: 'endToday' }, undefined])
  })

  test('End it today ends the change yesterday, so it moves to Past', async () => {
    const team = await newTeam()
    await withPaceRange(team)
    await onward(team, '80', '2026-10-12')

    const ended = await submit(team, { kind: 'endCapacityToday', id: '1' })

    expect(ended).toEqual({ saved: true, next: { screen: 'forecast' } })
    expect((await capacity(team)).past).toEqual([{ id: 1, from: '2026-10-12', to: '2026-11-10', percent: 80, note: 'Two left' }])
  })
})

describe('refused', () => {
  test('an entry no longer there, or one that has ended, changes nothing and says why', async () => {
    const team = await newTeam()
    await withPaceRange(team)
    await submit(team, { kind: 'addCapacity', percent: '80', from: '2026-10-12', to: '2026-10-16', onward: false, note: '' })

    const gone = await submit(team, { kind: 'endCapacityToday', id: '7' })
    const ended = await submit(team, { kind: 'acceptNewUsual', id: '1' })

    expect(gone).toMatchObject(refusedOnForecast('That entry is no longer there.'))
    expect(ended).toMatchObject(refusedOnForecast('That entry has already ended.'))
    expect((await capacity(team)).past).toEqual([{ id: 1, from: '2026-10-12', to: '2026-10-16', percent: 80, note: '' }])
  })

  test('a change that starts today or later has nothing to end', async () => {
    const team = await newTeam()
    await withPaceRange(team)
    await onward(team, '80', TODAY)

    const ended = await submit(team, { kind: 'endCapacityToday', id: '1' })

    expect(ended).toMatchObject(refusedOnForecast('It hasn’t started yet, so there’s nothing to end: remove it instead.'))
  })
})
