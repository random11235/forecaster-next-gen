import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'

// The Storage contract's cases for stored JSON of a shape this version doesn't read, beside storageContract.test.ts:
// the SQLite file refuses it, naming its column, rather than reading it as something it isn't; the browser's storage
// starts empty, as it does on data it can't parse. Each case writes the blob straight into the store, as a later
// version or a damaged file would leave it.

const TEAM: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' }

const LAUNCH: MilestoneInputs = {
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
  paceWindow: { action: { kind: 'startFrom', date: '2026-10-12' }, skippedPeriods: ['2026-09-28'] },
  seenReads: { ticketsRemaining: '2026-11-12T09:00:00Z', pace: undefined },
}

const PICKED: MilestoneQuery = { picks: [{ kind: 'label', name: 'payments', query: 'label:"payments"' }], query: 'label:"payments"' }

let dir: string | undefined
let open: SqliteStorage | undefined

afterEach(() => {
  open?.close()
  open = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** A SQLite file holding the team's milestone inputs, queries and setup draft, as saved through storage. */
function savedFile(): string {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
  const file = join(dir, 'forecaster.db')
  const storage = openSqliteStorage(file)
  storage.saveTeam(TEAM)
  storage.saveMilestoneInputs(LAUNCH)
  storage.saveMilestoneQuery('team', PICKED)
  storage.saveComparableWorkQuery('team', PICKED)
  storage.saveSetupDraft('team', { milestoneQuery: PICKED, comparableWorkQuery: PICKED, reads: [] })
  storage.close()
  return file
}

/** Writes `json` straight into `column` of `table`, as a later version or a damaged file would leave it. */
function store(file: string, table: string, column: string, json: string): void {
  const db = new DatabaseSync(file)
  db.prepare(`UPDATE ${table} SET ${column} = ?`).run(json)
  db.close()
}

describe('SQLite storage holding stored JSON of a shape it does not read', () => {
  test('reads back each stored JSON value as saved', () => {
    const storage = (open = openSqliteStorage(savedFile()))

    expect(storage.milestoneInputs('team')).toEqual(LAUNCH)
    expect(storage.milestoneQuery('team')).toEqual(PICKED)
    expect(storage.comparableWorkQuery('team')).toEqual(PICKED)
    expect(storage.setupDraft('team')).toEqual({ milestoneQuery: PICKED, comparableWorkQuery: PICKED, reads: [] })
  })

  const read: Record<string, (storage: SqliteStorage) => unknown> = {
    milestone_inputs: (storage) => storage.milestoneInputs('team'),
    milestone_queries: (storage) => storage.milestoneQuery('team'),
    comparable_work_queries: (storage) => storage.comparableWorkQuery('team'),
    setup_drafts: (storage) => storage.setupDraft('team'),
  }

  test.each([
    ['milestone_inputs', 'pace_counts', '{"low":4}'],
    ['milestone_inputs', 'pace_counts', '[4,"seven"]'],
    ['milestone_inputs', 'pace_window', '[]'],
    ['milestone_inputs', 'pace_window', '{"action":{"kind":"startFrom"}}'],
    ['milestone_inputs', 'pace_window', '{"skippedPeriods":"2026-09-28"}'],
    ['milestone_inputs', 'seen_reads', '"seen"'],
    ['milestone_inputs', 'seen_reads', '{"pace":3}'],
    ['milestone_queries', 'picks', '{}'],
    ['milestone_queries', 'picks', '[{"kind":"label","name":"payments"}]'],
    ['comparable_work_queries', 'picks', '[null]'],
    ['setup_drafts', 'milestone_picks', 'not json'],
    ['setup_drafts', 'comparable_work_picks', '[{"kind":"label","name":7,"query":""}]'],
  ])('refuses %s.%s holding %s, naming the column', (table, column, json) => {
    const file = savedFile()
    store(file, table, column, json)
    const storage = (open = openSqliteStorage(file))

    expect(() => read[table]!(storage)).toThrow(`${table}.${column}`)
  })
})

describe('browser storage holding stored JSON of a shape it does not read', () => {
  function memoryStore(json: string): KeyValueStore {
    const items = new Map([['forecaster', json]])
    return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
  }

  test.each([
    ['a list, not an object', '[]'],
    ['teams that are not a list', '{"teams":"My team"}'],
    ['a team and milestone inputs that are a list', `{"teams":${JSON.stringify([TEAM])},"milestoneInputs":[]}`],
    ['capacity off that is not a list', '{"teams":[],"capacityOff":"team"}'],
  ])('with %s, starts empty', (_, json) => {
    const storage = openWebStorage(memoryStore(json))

    expect(storage.isEmpty()).toBe(true)
    expect(storage.teams()).toEqual([])
    expect(storage.capacityOn('team')).toBe(true)
  })
})
