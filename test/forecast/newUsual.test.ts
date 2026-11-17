import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView, type CapacityView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// New usual (#153, #169): once every period the pace comes from falls after a lasting change, the pace already shows
// it, so the tool proposes ending it rather than counting it twice.

const TEAM = 'ACME'
/** A Wednesday, in the second week from the start date. */
const TODAY = '2026-11-11'
/**
 * A Monday. Typed counts are dated back from the current period (from 9 Nov), the last being the most recent whole
 * one: four counts are the weeks from 12, 19 and 26 Oct and 2 Nov.
 */
const START = '2026-11-02'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-new-usual-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

function openStorage(): Storage {
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

/** 20 tickets, in weeks from 2 Nov, at four typed counts. */
function withTypedCounts(storage: Storage): void {
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '20' })
  submit(storage, { kind: 'setPaceCounts', counts: '4, 5, 4, 5' })
  submit(storage, { kind: 'setPaceMode', paceMode: 'counts' })
}

function withPaceRange(storage: Storage): void {
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '20' })
  submit(storage, { kind: 'setPaceRange', low: '4', high: '5' })
}

function submit(storage: Storage, edit: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit)
}

function onward(storage: Storage, percent: string, from: string): void {
  submit(storage, { kind: 'addCapacity', percent, from, to: '', onward: true, note: 'Two left' })
}

function capacity(storage: Storage): CapacityView {
  const view = milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)
  if (view.kind !== 'forecast') throw new Error(`no forecast: ${view.kind}`)
  return view.capacity
}

describe('with typed counts', () => {
  test('while only some of the weeks the pace comes from are after a lasting change, it says how many', () => {
    const storage = openStorage()
    withTypedCounts(storage)
    onward(storage, '80', '2026-10-19')

    expect(capacity(storage).entries[0]?.newUsual).toEqual({ kind: 'counting', after: 3, of: 4 })
  })

  test('a change that starts mid-week counts only the weeks that start on or after it', () => {
    const storage = openStorage()
    withTypedCounts(storage)
    onward(storage, '80', '2026-10-20')

    expect(capacity(storage).entries[0]?.newUsual).toEqual({ kind: 'counting', after: 2, of: 4 })
  })

  test('once every week the pace comes from is after it, the change is proposed as the new usual', () => {
    const storage = openStorage()
    withTypedCounts(storage)
    onward(storage, '80', '2026-10-12')

    expect(capacity(storage).entries[0]?.newUsual).toEqual({ kind: 'proposed' })
  })

  test('a change with an end, or one still to start, has no new-usual line', () => {
    const storage = openStorage()
    withTypedCounts(storage)
    submit(storage, { kind: 'addCapacity', percent: '80', from: '2026-10-12', to: '2026-12-31', onward: false, note: '' })
    onward(storage, '120', '2026-12-01')

    expect(capacity(storage).entries.map(({ newUsual }) => newUsual)).toEqual([undefined, undefined])
  })

  test('accepting ends the change today, records the accept and moves it to Past, so it is no longer counted', () => {
    const storage = openStorage()
    withTypedCounts(storage)
    onward(storage, '80', '2026-10-12')

    const accepted = submit(storage, { kind: 'acceptNewUsual', id: '1' })

    expect(accepted).toEqual({ saved: true, next: 'forecast' })
    const { entries, past } = capacity(storage)
    expect(entries).toEqual([])
    expect(past).toEqual([{ id: 1, from: '2026-10-12', to: TODAY, percent: 80, note: 'Two left', newUsualOn: TODAY }])
  })

  test('keeping it stops the proposal, and the change still counts', () => {
    const storage = openStorage()
    withTypedCounts(storage)
    onward(storage, '80', '2026-10-12')

    const kept = submit(storage, { kind: 'keepCapacity', id: '1' })

    expect(kept).toEqual({ saved: true, next: 'forecast' })
    const [entry] = capacity(storage).entries
    expect(entry?.newUsual).toBeUndefined()
    expect(entry?.kept).toBe(true)
  })
})

describe('with a pace range', () => {
  test('there is no proposal: a lasting change that has started offers End it today', () => {
    const storage = openStorage()
    withPaceRange(storage)
    onward(storage, '80', '2026-10-12')
    onward(storage, '120', '2026-12-01')

    expect(capacity(storage).entries.map(({ newUsual }) => newUsual)).toEqual([{ kind: 'endToday' }, undefined])
  })

  test('End it today ends the change yesterday, so it moves to Past', () => {
    const storage = openStorage()
    withPaceRange(storage)
    onward(storage, '80', '2026-10-12')

    const ended = submit(storage, { kind: 'endCapacityToday', id: '1' })

    expect(ended).toEqual({ saved: true, next: 'forecast' })
    expect(capacity(storage).past).toEqual([{ id: 1, from: '2026-10-12', to: '2026-11-10', percent: 80, note: 'Two left' }])
  })
})

describe('refused', () => {
  test('an entry no longer there, or one that has ended, changes nothing and says why', () => {
    const storage = openStorage()
    withPaceRange(storage)
    submit(storage, { kind: 'addCapacity', percent: '80', from: '2026-10-12', to: '2026-10-16', onward: false, note: '' })

    const gone = submit(storage, { kind: 'endCapacityToday', id: '7' })
    const ended = submit(storage, { kind: 'acceptNewUsual', id: '1' })

    expect(!gone.saved && gone.screen === 'forecast' && gone.view.kind === 'forecast' && gone.view.capacity.refusal).toBe('That entry is no longer there.')
    expect(!ended.saved && ended.screen === 'forecast' && ended.view.kind === 'forecast' && ended.view.capacity.refusal).toBe('That entry has already ended.')
    expect(capacity(storage).past).toEqual([{ id: 1, from: '2026-10-12', to: '2026-10-16', percent: 80, note: '' }])
  })

  test('a change that starts today or later has nothing to end', () => {
    const storage = openStorage()
    withPaceRange(storage)
    onward(storage, '80', TODAY)

    const ended = submit(storage, { kind: 'endCapacityToday', id: '1' })

    expect(!ended.saved && ended.screen === 'forecast' && ended.view.kind === 'forecast' && ended.view.capacity.refusal).toBe(
      'It hasn’t started yet, so there’s nothing to end: remove it instead.',
    )
  })
})
