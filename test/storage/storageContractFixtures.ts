import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// What the Storage contract's files share (storageContract*.test.ts): the team and its milestone's inputs, and a
// SQLite file to keep them in.

export const TEAM: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' }

export const LAUNCH: MilestoneInputs = {
  teamId: 'team',
  name: 'Launch',
  startDate: '2026-11-02',
  ticketsRemaining: 30,
  ticketsSource: 'typed',
  ambiguity: 'high',
  cadenceDays: 14,
  paceMode: 'counts',
  paceRange: { low: 5, high: 10 },
  paceCounts: [4, 7, 6],
  paceCadenceDays: 14,
  paceWindow: { action: { kind: 'startFrom', date: '2026-10-12' }, skippedPeriods: [] },
  seenReads: { ticketsRemaining: undefined, pace: undefined },
}

/** A SQLite file in a folder of its own: its path, storage opened on it, and `reopen`, which closes that and opens it again. */
export interface SqliteFile {
  file: string
  storage: SqliteStorage
  reopen(): SqliteStorage
}

/**
 * Opens SQLite files for a test file's tests, each in a new temporary folder; after each test the storage last
 * opened is closed and the folder removed. Call it once, at the top of the test file.
 */
export function temporarySqliteFiles(): () => SqliteFile {
  let dir: string | undefined
  let open: SqliteStorage | undefined

  afterEach(() => {
    open?.close()
    open = undefined
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  return () => {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): SqliteStorage => {
      open?.close()
      return (open = openSqliteStorage(file))
    }
    return { file, storage: reopen(), reopen }
  }
}
