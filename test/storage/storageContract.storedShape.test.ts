import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'

// The Storage contract's cases for stored JSON of a shape this version doesn't read, beside storageContract.test.ts,
// run against both storages: each refuses it, naming where it is kept, rather than reading it as something it isn't,
// and never writes over it. Only the seeding differs: each case writes the value straight into the store, as a later
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
let open: Storage | undefined

afterEach(() => {
  open?.close()
  open = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** A stored value this version can't read: where it is kept, as the refusal names it, what it holds, and the value. */
type Refused = [where: string, holding: string, stored: string]

/** A storage under test: its seeding, and how a value kept at `where` is read. */
interface Subject {
  /** Opens storage on the team and its milestone's inputs as saved through it, with `refused` written over its place. */
  opened(refused?: Refused): { storage: () => Storage; read: (storage: Storage) => unknown }
  /** Values of a shape it doesn't read, each named by where it is kept. */
  refused: Refused[]
}

const SQLITE_READS: Record<string, (storage: SqliteStorage) => unknown> = {
  milestone_inputs: (storage) => storage.milestoneInputs('team'),
  milestone_queries: (storage) => storage.milestoneQuery('team'),
  comparable_work_queries: (storage) => storage.comparableWorkQuery('team'),
  setup_drafts: (storage) => storage.setupDraft('team'),
}

const sqlite: Subject = {
  opened(refused) {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const saved = openSqliteStorage(file)
    saved.saveTeam(TEAM)
    saved.saveMilestoneInputs(LAUNCH)
    saved.saveMilestoneQuery('team', PICKED)
    saved.saveComparableWorkQuery('team', PICKED)
    saved.saveSetupDraft('team', { milestoneQuery: PICKED, comparableWorkQuery: PICKED, reads: [] })
    saved.close()
    const [table, column] = refused?.[0].split('.') ?? ['milestone_inputs']
    if (refused) {
      const db = new DatabaseSync(file)
      db.prepare(`UPDATE ${table} SET ${column} = ?`).run(refused[2])
      db.close()
    }
    return {
      storage: () => {
        open?.close()
        return (open = openSqliteStorage(file))
      },
      read: (storage) => SQLITE_READS[table!]!(storage as SqliteStorage),
    }
  },
  refused: [
    ['milestone_inputs.pace_counts', '{"low":4}', '{"low":4}'],
    ['milestone_inputs.pace_counts', '[4,"seven"]', '[4,"seven"]'],
    ['milestone_inputs.pace_window', '[]', '[]'],
    ['milestone_inputs.pace_window', '{"action":{"kind":"startFrom"}}', '{"action":{"kind":"startFrom"}}'],
    ['milestone_inputs.pace_window', '{"skippedPeriods":"2026-09-28"}', '{"skippedPeriods":"2026-09-28"}'],
    ['milestone_inputs.seen_reads', '"seen"', '"seen"'],
    ['milestone_inputs.seen_reads', '{"pace":3}', '{"pace":3}'],
    ['milestone_queries.picks', '{}', '{}'],
    ['milestone_queries.picks', '[{"kind":"label","name":"payments"}]', '[{"kind":"label","name":"payments"}]'],
    ['comparable_work_queries.picks', '[null]', '[null]'],
    ['setup_drafts.milestone_picks', 'not json', 'not json'],
    ['setup_drafts.comparable_work_picks', '[{"kind":"label","name":7,"query":""}]', '[{"kind":"label","name":7,"query":""}]'],
  ],
}

/** Browser storage holding everything under one key, as `localStorage` keeps it. */
const KEY = '"forecaster"'

/** The browser's stored value with the team's milestone inputs replaced by `inputs` (`LAUNCH`'s fields, changed). */
const withInputs = (inputs: Record<string, unknown>): string => JSON.stringify({ teams: [TEAM], milestoneInputs: { team: { ...LAUNCH, ...inputs } } })

const browser: Subject = {
  opened(refused) {
    const items = new Map<string, string>()
    const store: KeyValueStore = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
    const saved = openWebStorage(store)
    saved.saveTeam(TEAM)
    saved.saveMilestoneInputs(LAUNCH)
    if (refused) items.set('forecaster', refused[2])
    return { storage: () => (open = openWebStorage(store)), read: (storage) => storage.milestoneInputs('team') }
  },
  refused: [
    [KEY, "text that isn't JSON", 'not json'],
    [KEY, 'a list, not an object', '[]'],
    [KEY, 'teams that are not a list', '{"teams":"My team"}'],
    [KEY, "a team from a source it doesn't know", JSON.stringify({ teams: [{ ...TEAM, source: 'trello' }] })],
    [KEY, 'milestone inputs that are a list', JSON.stringify({ teams: [TEAM], milestoneInputs: [] })],
    [KEY, "a team's milestone inputs that are text", JSON.stringify({ teams: [TEAM], milestoneInputs: { team: 'Launch' } })],
    [KEY, 'a milestone name that is a number', withInputs({ name: 7 })],
    [KEY, "an ambiguity it doesn't know", withInputs({ ambiguity: 'extreme' })],
    [KEY, "a pace mode it doesn't know", withInputs({ paceMode: 'guess' })],
    [KEY, "a tickets source it doesn't know", withInputs({ ticketsSource: 'both' })],
    [KEY, 'a pace range with no high', withInputs({ paceRange: { low: 5 } })],
    [KEY, 'pace counts that are not all numbers', withInputs({ paceCounts: [4, 'seven'] })],
    [KEY, 'a pace window starting from no date', withInputs({ paceWindow: { action: { kind: 'startFrom' } } })],
    [KEY, 'a pace read seen that is a number', withInputs({ seenReads: { pace: 3 } })],
    [KEY, 'ambiguity ranges missing a level', JSON.stringify({ teams: [TEAM], ambiguityRanges: { team: { teamId: 'team', low: { low: 1 } } } })],
    [KEY, "a team's capacity entries that are text", JSON.stringify({ teams: [TEAM], capacityEntries: { team: 'x' } })],
    [KEY, 'a capacity entry with no percent', JSON.stringify({ teams: [TEAM], capacityEntries: { team: [{ id: 1, from: '2026-09-14', note: '' }] } })],
    [
      KEY,
      'a capacity entry kept as false',
      JSON.stringify({ teams: [TEAM], capacityEntries: { team: [{ id: 1, from: '2026-09-14', percent: 0, note: '', kept: false }] } }),
    ],
    [KEY, 'capacity off that is not a list', '{"teams":[],"capacityOff":"team"}'],
  ],
}

describe.each([
  ['SQLite', sqlite],
  ['browser', browser],
])('%s storage holding stored JSON of a shape it does not read', (_, subject) => {
  test('reads back each stored JSON value as saved', () => {
    const { storage } = subject.opened()

    expect(storage().milestoneInputs('team')).toEqual(LAUNCH)
  })

  test.each(subject.refused)('refuses %s holding %s, naming where it is kept', (where, holding, stored) => {
    const { storage, read } = subject.opened([where, holding, stored])
    const opened = storage()

    expect(() => read(opened)).toThrow(where)
  })

  test.each(subject.refused)('keeps %s holding %s as it was, refusing it still once saved over and opened again', (where, holding, stored) => {
    const { storage, read } = subject.opened([where, holding, stored])

    try {
      storage().saveTeam({ ...TEAM, name: 'Payments' })
    } catch {
      // browser storage refuses every save over what it refused
    }

    expect(() => read(storage())).toThrow(where)
  })
})

test('SQLite storage reads back the queries and setup draft as saved', () => {
  const storage = sqlite.opened().storage() as SqliteStorage

  expect(storage.milestoneQuery('team')).toEqual(PICKED)
  expect(storage.comparableWorkQuery('team')).toEqual(PICKED)
  expect(storage.setupDraft('team')).toEqual({ milestoneQuery: PICKED, comparableWorkQuery: PICKED, reads: [] })
})
