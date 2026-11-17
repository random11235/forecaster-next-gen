import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { openSqliteStorage, type SqliteStorage } from '../src/storage/sqliteStorage.js'

// A database file of each test's own, for the test files that open storage on a real file: a fresh temporary
// directory per test, and the storage opened in it closed after.

let dir: string | undefined
let storage: SqliteStorage | undefined

/** Gives each test of the calling file a fresh temporary directory named from `prefix`, closing its storage and removing it after. */
export function useTempDatabase(prefix: string): void {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix))
  })

  afterEach(() => {
    storage?.close()
    storage = undefined
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })
}

/** Opens the test's database file, as a restart would, closing any storage it had open. */
export function openStorage(): SqliteStorage {
  if (!dir) throw new Error('no temporary directory: call useTempDatabase() in the test file first')
  storage?.close()
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  return storage
}

/** The storage the test opened last. */
export function currentStorage(): SqliteStorage {
  if (!storage) throw new Error('no storage open: call openStorage() first')
  return storage
}
