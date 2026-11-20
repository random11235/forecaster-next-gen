import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { LoggedForecast } from '../../src/ledger/ledger.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// What the Storage contract's files share (storageContract*.test.ts): the team, its milestone's inputs and picks, and
// a SQLite file to keep them in.

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

/**
 * A forecast to log: 30 tickets at 4, 7 or 6 a fortnight, growing 1.4–2.5×, from 2 Nov 2026, with a half-capacity
 * first fortnight, and what the engine gave for it (as storage keeps it, any result of this shape will do).
 */
export const FORECAST: LoggedForecast = {
  teamId: 'team',
  milestoneName: 'Launch',
  caseHash: '0123456789abcdef',
  appVersion: '0.4.2',
  simulationCase: {
    engineVersion: '2',
    seed: 1,
    trials: 4,
    maxPeriods: 52,
    question: { kind: 'when' },
    startDate: '2026-11-02',
    periodDays: 14,
    scope: [{ epicId: 'team', rank: 1, baseCount: 30, currentCount: 30, doneCount: 0, growth: { low: 1.4, high: 2.5 } }],
    throughputSamples: [4, 7, 6],
    epicSizeSamples: { low: 0, high: 0 },
    capacity: [0.5],
    percentiles: [50, 85],
  },
  result: {
    caseHash: '0123456789abcdef',
    quantiles: [6, 7, 8, null],
    finishCounts: [0, 0, 0, 0, 0, 0, 1, 1, 1],
    finishedFraction: 0.75,
    percentileDates: { 50: '2027-02-22', 85: null },
    percentileCounts: {},
    perEpic: [{ epicId: 'team', quantiles: [6, 7, 8, null] }],
    diagnostics: { paceVariation: 0.15, trialsHittingHorizon: 1, span: { periods: 7, tickets: 54 } },
  },
}

/** Picks of two kinds and the query they make, for the milestone or comparable work. */
export const PICKED: MilestoneQuery = {
  picks: [
    { kind: 'epic', name: 'Checkout redesign', query: 'parent-issue:acme/checkout#106' },
    { kind: 'label', name: 'payments', query: 'label:"payments"' },
  ],
  query: 'parent-issue:acme/checkout#106 OR label:"payments"',
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
