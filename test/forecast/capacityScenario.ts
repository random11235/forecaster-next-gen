import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// The arrangement capacity.test.ts and capacity.entries.test.ts share: a team in a fresh SQLite file for each test,
// removed after, the milestone entered, and the means to type capacity and read the forecast.

export const TEAM = 'ACME'
export const TODAY = '2026-08-24'
/** A Monday, so each week from it runs Monday to Sunday. */
export const MONDAY = '2026-09-07'

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-capacity-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

export function openStorage(): Storage {
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

/** 10 tickets at exactly 5 a week, growing 1×, from Monday 7 Sep: with usual capacity, done on 21 Sep. */
export function tenTicketsAtFive(storage: Storage, { cadenceDays = '7', pace = '5' } = {}): void {
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1 }, medium: { low: 1, high: 1 }, high: { low: 1, high: 1 } })
  submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: MONDAY, ticketsRemaining: '10' })
  submit(storage, { kind: 'setCadence', cadenceDays })
  submit(storage, { kind: 'setPaceRange', low: pace, high: pace })
}

export function submit(storage: Storage, edit: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit)
}

/** The EM types capacity as one sentence: "The team is at {percent}% from {from} to {to}, or onward, for {note}." */
export function add(storage: Storage, percent: string, from: string, to: string, { onward = false, note = '' } = {}) {
  return submit(storage, { kind: 'addCapacity', percent, from, to, onward, note })
}

export function view(storage: Storage) {
  return milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)
}

/** The 85% date the headline gives. */
export function headline(storage: Storage): string | null | undefined {
  const forecast = view(storage)
  return forecast.kind === 'forecast' ? forecast.dates.find(({ percent }) => percent === 85)?.date : undefined
}

/** The forecast, less its Capacity section. */
export function withoutCapacity(forecast: ReturnType<typeof view>) {
  if (forecast.kind !== 'forecast') return forecast
  const { capacity: _, ...rest } = forecast
  return rest
}
