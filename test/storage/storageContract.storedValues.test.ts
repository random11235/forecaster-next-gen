import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import type { FailedRead } from '../../src/model/readFailures.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import { STORED_UNIONS } from './storedUnions.js'

// What the typecheck can't see in the SQLite file, against STORED_UNIONS: that it writes read_failures.of as exactly
// ReadFailureOf's values, which no `save…` method takes, so renaming one in src/storage/lib/setupTables.ts fails here; and that it
// reads back every value of each union it reads through a list of its own, so one added to a union but not the list
// fails.

const TEAM: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' }
const AT = '2026-11-12T09:00:00Z'

/** Every value STORED_UNIONS lists in `values`. */
const valuesOf = <V extends Readonly<Record<string, true>>>(values: V) => Object.keys(values) as (keyof V & string)[]

let dir: string | undefined
let open: SqliteStorage | undefined

afterEach(() => {
  open?.close()
  open = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** A SQLite file with the team saved, `reopen` opening it again as the next run of the app would. */
function sqliteFile(): { storage: SqliteStorage; reopen: () => SqliteStorage; file: string } {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
  const file = join(dir, 'forecaster.db')
  const reopen = (): SqliteStorage => {
    open?.close()
    open = openSqliteStorage(file)
    return open
  }
  const storage = reopen()
  storage.saveTeam(TEAM)
  return { storage, reopen, file }
}

/** A failed read with `failure`: an `invalidQuery` says why. */
const failedWith = (failure: FailedRead['failure']): FailedRead =>
  failure === 'invalidQuery' ? { failure, message: 'No such label.', at: AT } : { failure, at: AT }

describe('SQLite storage writes each listed value, and reads back each union through a list of its own', () => {
  test('writes which read failures a row holds as ReadFailureOf, every value and nothing else', () => {
    const { storage, file } = sqliteFile()
    storage.saveReadFailures('team', {
      whole: failedWith('unavailable'),
      queries: { 'label:"bug"': failedWith('notFound') },
      picks: { 'label:"bug"': failedWith('outOfScope') },
    })
    const db = new DatabaseSync(file)
    const written = db.prepare('SELECT DISTINCT of FROM read_failures ORDER BY of').all()
    db.close()

    expect(written.map((row) => row.of)).toStrictEqual(valuesOf(STORED_UNIONS.ReadFailureOf.values).sort())
  })

  test('reads back every failure a read can have', () => {
    const { reopen } = sqliteFile()
    for (const failure of valuesOf(STORED_UNIONS['FailedRead.failure'].values)) {
      reopen().saveReadFailures('team', { whole: failedWith(failure) })
      expect(reopen().readFailures('team')).toStrictEqual({ whole: failedWith(failure) })
    }
  })

  test('reads back every way setup can be closed, closed and reopened', () => {
    const { reopen } = sqliteFile()
    for (const closed of valuesOf(STORED_UNIONS.SetupClosed.values))
      for (const state of [{ open: false, closed } as const, { open: true, reopened: closed } as const]) {
        reopen().saveSetupState('team', state)
        expect(reopen().setupState('team')).toStrictEqual(state)
      }
  })

  test('reads back every change an opening of setup made to the connection', () => {
    const { reopen } = sqliteFile()
    for (const connection of valuesOf(STORED_UNIONS.ConnectionChange.values)) {
      reopen().saveSetupState('team', { open: true, connection })
      expect(reopen().setupState('team')).toStrictEqual({ open: true, connection })
    }
  })

  test('reads back every drafted source of tickets remaining and of pace', () => {
    const { reopen } = sqliteFile()
    for (const ticketsRemaining of valuesOf(STORED_UNIONS.TicketsSource.values))
      for (const pace of valuesOf(STORED_UNIONS.PaceMode.values)) {
        reopen().saveSetupDraft('team', { reads: [], sources: { ticketsRemaining, pace } })
        expect(reopen().setupDraft('team')).toStrictEqual({ reads: [], sources: { ticketsRemaining, pace } })
      }
  })
})
