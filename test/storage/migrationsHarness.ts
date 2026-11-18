import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect } from 'vitest'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { MilestoneQueryStorage, SavedReadStorage, SetupStorage, Storage } from '../../src/storage/storage.js'
import { stepWriteProblems, topLevelDescribe } from './migrationStep.js'
import { TEAM } from './pastSchemas.js'

// The migration tests' shared arrangement: each test writes a data file the way an earlier release left it (from
// pastSchemas.ts), opens it through openSqliteStorage, and checks what reads back. A test under a top-level
// `describe('step N: …')` fails unless it writes a file, and each at version N - 1 (stepWriteProblems in
// migrationStep.ts).

/** What these tests read back from a migrated file: its inputs, and the milestone's query and saved reads. */
export type Opened = Storage & MilestoneQueryStorage & SavedReadStorage & SetupStorage

export const AN_ISO_TIMESTAMP = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)

let dir: string
let storage: Opened | undefined
/** The version of each data file the running test wrote. One list for the file: it assumes its tests don't run concurrently. */
let written: number[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-migrations-'))
  written = []
})

afterEach(({ task }) => {
  closeStorage()
  rmSync(dir, { recursive: true, force: true })
  // a test that already failed, before it wrote a file perhaps, has its own error to show
  if (task.result?.state === 'fail') return
  const problems = stepWriteProblems(topLevelDescribe(task), written)
  if (problems.length > 0) throw new Error(problems.join('\n'))
})

/** The path of `name` in the test's own directory. */
export function fileIn(name: string): string {
  return join(dir, name)
}

/** Closes the storage the test last opened, if any. */
export function closeStorage(): void {
  storage?.close()
  storage = undefined
}

/** Writes a data file the way an earlier release left it: `sql` run against a new file, at `version`. */
export function writeFile(name: string, sql: string, version = 0): string {
  const file = fileIn(name)
  const db = new DatabaseSync(file)
  db.exec(sql)
  db.exec(`PRAGMA user_version = ${version}`)
  db.close()
  written.push(version)
  return file
}

export function open(file: string): Opened {
  storage?.close()
  storage = openSqliteStorage(file)
  return storage
}

/** The schema version the file records, read straight from the file once storage has closed it. */
export function versionOf(file: string): number {
  closeStorage()
  const db = new DatabaseSync(file)
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  db.close()
  return user_version
}

/** Each table's columns and indexes, as SQLite reports them, so files built by different routes can be compared. */
export function schemaOf(file: string): Record<string, unknown> {
  const db = new DatabaseSync(file)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
  const schema = Object.fromEntries(
    tables.map(({ name }) => [
      String(name),
      {
        columns: db.prepare(`PRAGMA table_info(${String(name)})`).all(),
        indexes: db.prepare(`PRAGMA index_list(${String(name)})`).all(),
        foreignKeys: db.prepare(`PRAGMA foreign_key_list(${String(name)})`).all(),
      },
    ]),
  )
  db.close()
  return schema
}

/**
 * The rows `sql` reads, straight from the file once storage has closed it: for the tables earlier releases wrote, which
 * the MVP no longer reads but keeps for #6's follow-on work.
 */
export function rowsOf(file: string, sql: string): Record<string, unknown>[] {
  closeStorage()
  const db = new DatabaseSync(file)
  const rows = db
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }))
  db.close()
  return rows
}

/** Ambiguity ranges other than the defaults, to tell them apart. */
export const EDITED_RANGES = {
  teamId: TEAM,
  low: { low: 1, high: 1.25 },
  medium: { low: 1, high: 2.5 },
  high: { low: 1.5, high: 4 },
}
