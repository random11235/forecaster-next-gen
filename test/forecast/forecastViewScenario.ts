import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect } from 'vitest'
import { inputsView, submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { GrowthRange } from '../../src/model/ambiguity.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// The arrangement the Milestone forecast view's tests (milestoneForecastView.test.ts and the
// milestoneForecastView.*.test.ts beside it) share: a team in a fresh SQLite file for each test, removed after, and the
// means to enter inputs and read the views.

export const TEAM = 'ACME'
/** Today, fixed: before every start date these tests enter, unless a test says the start date is past. */
export const TODAY = '2026-08-24'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

/** The SQLite file the app would use, in a fresh directory per test. */
export const storageFile = (): string => join(dir, 'forecaster.db')

/** Opens it, closing the one opened before. */
export function openStorage(): Storage {
  storage?.close()
  storage = openSqliteStorage(storageFile())
  return storage
}

/** A team with nothing entered yet, in `storage`: the SQLite file the app would use, unless another is given. */
export function newTeam(storage: Storage = openStorage()): Storage {
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'jira', sourceRef: TEAM, installedAt: '2026-01-01T00:00:00Z' })
  return storage
}

/** Sets the team's medium growth range: the growth of a milestone of medium ambiguity, the default. */
export function mediumGrowth(storage: Storage, medium: GrowthRange): void {
  storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1.5 }, medium, high: { low: 1.5, high: 3 } })
}

export function submit(storage: Storage, change: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, change)
}

/** Submits a form on the Inputs screen: saved, or why it was refused there. */
export function edit(storage: Storage, change: InputsEdit) {
  const submitted = submit(storage, change)
  if (submitted.saved) return { ok: true }
  return submitted.screen === 'inputs' ? { ok: false, error: submitted.view.refusal.error } : { ok: false, screen: submitted.screen }
}

/** The EM enters the milestone and a pace range, as the Inputs screen does. */
export function enter(storage: Storage, milestone: { startDate: string; ticketsRemaining: string }, pace: { low: string; high: string }): void {
  expect(edit(storage, { kind: 'setMilestone', name: 'Checkout v2', ...milestone })).toEqual({ ok: true })
  expect(edit(storage, { kind: 'setPaceRange', ...pace })).toEqual({ ok: true })
}

/** 100 tickets at 4–8 a week, growing 1–2×, from 1 Sep 2026: the engine's dates for the fixed seed. */
export const DATES_FROM_1_SEP = [
  { percent: 50, date: '2027-03-02' },
  { percent: 70, date: '2027-03-23' },
  { percent: 85, date: '2027-04-06' },
  { percent: 95, date: '2027-04-20' },
]

/** The same forecast started two weeks later: every date two weeks later. */
export const DATES_FROM_15_SEP = [
  { percent: 50, date: '2027-03-16' },
  { percent: 70, date: '2027-04-06' },
  { percent: 85, date: '2027-04-20' },
  { percent: 95, date: '2027-05-04' },
]

export function view(storage: Storage, settings = DEFAULT_SETTINGS) {
  return milestoneForecastView(storage, TEAM, settings, TODAY)
}

export function inputsScreenView(storage: Storage, settings = DEFAULT_SETTINGS) {
  return inputsView(storage, TEAM, settings, TODAY)
}
