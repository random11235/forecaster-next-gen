import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect } from 'vitest'
import { openForecasting, type Forecasting, type InputsEdit } from '../../src/forecast/index.js'
import type { GrowthRange } from '../../src/model/ambiguity.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage } from '../../src/storage/webStorage.js'
import type { memoryStore } from '../memoryStore.js'
import { TEAM, TODAY } from './forecastViewScenario.js'

// The arrangement the forecast ledger's tests share (forecastLedger.test.ts and forecastLedger.*.test.ts): the team's
// handle, as the browser build opens it on TODAY, on a storage the ledger goes in through that stays when the handle is
// opened again (a SQLite file, or the web build's browser storage), so a restart reads the ledger back from it.
// forecastingForTest keeps its storage in memory, which a restart doesn't reopen, and offers no storage of the test's own.

/** The team's handle on a storage of its own, reopened with the handle on `restart`. */
export interface LedgerTeam extends Pick<Forecasting, 'submit' | 'milestoneForecastView'> {
  /** The storage the handle was opened on last. */
  readonly storage: Storage
  /** Opens the storage again, and the handle on it, as a restart does. */
  restart(): void
}

const CLOCK = { now: () => `${TODAY}T09:00:00Z`, timeZone: 'UTC' }

/** The team's handle on what `open` opens, opened again on each restart. */
function openedOn(open: () => Storage): LedgerTeam {
  let storage = open()
  let handle = openForecasting({ storage, clock: CLOCK })
  return {
    get storage() {
      return storage
    },
    submit: (edit, opening) => handle.submit(edit, opening),
    milestoneForecastView: (shown) => handle.milestoneForecastView(shown),
    restart() {
      storage = open()
      handle = openForecasting({ storage, clock: CLOCK })
    },
  }
}

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

/** Sets the team's medium growth range: the growth of a milestone of medium ambiguity, the default. */
export function mediumGrowth(team: LedgerTeam, medium: GrowthRange): void {
  team.storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1.5 }, medium, high: { low: 1.5, high: 3 } })
}

export const submit = (team: LedgerTeam, edit: InputsEdit) => team.submit({ form: 'inputs', edit })

/** The EM enters the milestone and a pace range, as the Inputs screen does. */
export async function enter(team: LedgerTeam, milestone: { startDate: string; ticketsRemaining: string }, pace: { low: string; high: string }): Promise<void> {
  expect(await submit(team, { kind: 'setMilestone', name: 'Checkout v2', ...milestone })).toMatchObject({ saved: true })
  expect(await submit(team, { kind: 'setPaceRange', ...pace })).toMatchObject({ saved: true })
}

export const view = (team: LedgerTeam) => team.milestoneForecastView()
