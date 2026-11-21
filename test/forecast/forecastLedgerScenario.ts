import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage } from '../../src/storage/webStorage.js'
import type { memoryStore } from '../memoryStore.js'
import { storedForecasting, type StoredForecasting } from './forecastingForTest.js'
import { TODAY } from './forecastViewScenario.js'

// The arrangement the forecast ledger's tests share (forecastLedger.test.ts and forecastLedger.*.test.ts): the team's
// handle, as the browser build opens it on TODAY, through storedForecasting on a storage the ledger goes in through
// that stays when the handle is opened again (a SQLite file, or the web build's browser storage), so a restart reads
// the ledger back from it.

/** The team's handle on a storage of its own, reopened with the handle on `restart`. */
export type LedgerTeam = Pick<StoredForecasting, 'storage' | 'restart' | 'submit' | 'milestoneForecastView' | 'rerunForecast'>

/** The team's handle on what `storedIn` opens, opened again on each restart. */
const openedOn = (storedIn: () => Storage): LedgerTeam => storedForecasting({ storedIn, clock: { now: `${TODAY}T09:00:00Z` } })

let dir: string | undefined
let opened: SqliteStorage | undefined

afterEach(() => {
  opened?.close()
  opened = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** The SQLite file the app would use, in a fresh directory for the test, removed after. */
export function storageFile(): string {
  dir ??= mkdtempSync(join(tmpdir(), 'forecaster-ledger-'))
  return join(dir, 'forecaster.db')
}

/** The team's handle on the app's SQLite file, which a restart opens again. */
export function onSqliteFile(): LedgerTeam {
  return openedOn(() => {
    opened?.close()
    opened = openSqliteStorage(storageFile())
    return opened
  })
}

/** The team's handle on the web build's browser storage, kept in `store`. */
export const inBrowser = (store: ReturnType<typeof memoryStore>): LedgerTeam => openedOn(() => openWebStorage(store))

export const view = (team: LedgerTeam) => team.milestoneForecastView()
