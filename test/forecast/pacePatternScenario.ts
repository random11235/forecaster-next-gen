import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// Pace patterns (#161): the tool reads the shape of the counts the Pace bars show and names it, with the team's
// numbers and never a cause, and where there's a forecast action it offers it with the 85% date both ways.
// The arrangement shared by the pacePattern.*.test.ts files: a milestone in a fresh file, its pace typed counts.

export const TEAM = 'ACME'
/** A Wednesday, in the second week from the start date. */
export const TODAY = '2026-11-11'
/**
 * A Monday. Typed counts are dated back from the current period (from 9 Nov), the last being the most recent whole
 * one: the week of 2 Nov. Ten counts are the weeks from 31 Aug to 2 Nov.
 */
export const START = '2026-11-02'

let dir: string
let storage: SqliteStorage | undefined

/** Gives each test of the calling file a fresh temporary directory, closing its storage and removing it after. */
export function useTempFile(): void {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-pace-pattern-'))
  })

  afterEach(() => {
    storage?.close()
    storage = undefined
    rmSync(dir, { recursive: true, force: true })
  })
}

/** Opens the test's file, closing any storage it had open. */
export function openStorage(): SqliteStorage {
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

export function submit(storage: Storage, edit: InputsEdit) {
  return submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit)
}

/** 60 tickets from 2 Nov, its pace the typed counts, oldest first. */
export function withTypedCounts(counts: readonly number[], cadenceDays = 7): Storage {
  const storage = openStorage()
  storage.saveTeam({ id: TEAM, name: 'Acme', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  submit(storage, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '60' })
  if (cadenceDays !== 7) submit(storage, { kind: 'setCadence', cadenceDays: String(cadenceDays) })
  submit(storage, { kind: 'setPaceCounts', counts: counts.join(', ') })
  submit(storage, { kind: 'setPaceMode', paceMode: 'counts' })
  return storage
}

export function forecast(storage: Storage) {
  const view = milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY)
  if (view.kind !== 'forecast') throw new Error(`no forecast: ${view.kind}`)
  return view
}
