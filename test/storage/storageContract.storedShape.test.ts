import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'
import { LAUNCH as SAVED, TEAM, temporarySqliteFiles } from './storageContractFixtures.js'

// The Storage contract's cases for stored JSON of a shape this version doesn't read, beside storageContract.test.ts,
// run against both storages: each refuses it, naming where it is kept, rather than reading it as something it isn't,
// and never writes over it. Only the seeding differs: each case writes the value straight into the store, as a later
// version or a damaged file would leave it.

const LAUNCH: MilestoneInputs = {
  ...SAVED,
  paceWindow: { action: { kind: 'startFrom', date: '2026-10-12' }, skippedPeriods: ['2026-09-28'] },
  seenReads: { ticketsRemaining: '2026-11-12T09:00:00Z', pace: undefined },
}

const PICKED: MilestoneQuery = { picks: [{ kind: 'label', name: 'payments', query: 'label:"payments"' }], query: 'label:"payments"' }

/** A Storage save, by its name. */
type Save = keyof Storage & `save${string}`

/** Each of the Storage contract's saves, of the team's records. */
const SAVES: Record<Save, (storage: Storage) => void> = {
  saveTeam: (storage) => storage.saveTeam({ ...TEAM, name: 'Payments' }),
  saveMilestoneInputs: (storage) => storage.saveMilestoneInputs({ ...LAUNCH, name: 'Beta' }),
  saveAmbiguityRanges: (storage) =>
    storage.saveAmbiguityRanges({ teamId: 'team', low: { low: 1, high: 1.2 }, medium: { low: 1.1, high: 1.5 }, high: { low: 1.2, high: 2 } }),
  saveCapacityEntries: (storage) => storage.saveCapacityEntries('team', []),
  saveCapacityOn: (storage) => storage.saveCapacityOn('team', false),
}

/** Storage holding a refused value: opened again on each call, the value read through it, and the value as kept. */
interface Opened {
  storage(): Storage
  read(): unknown
  kept(): unknown
}

/** A stored value this version can't read: where it is kept, as the refusal names it, and what it holds. */
interface Refused {
  where: string
  holding: string
  /** Opens storage on the team and its milestone's inputs as saved through it, with the value written over its place. */
  opened(): Opened
  /** The save that replaces the whole record holding the value, so doesn't keep it, if the storage keeps it apart. */
  ownSave?: Save
}

/** A storage under test: on the team and its milestone's inputs as saved, and values of a shape it doesn't read. */
interface Subject {
  saved(): Storage
  refused: Refused[]
  /** Whether every save throws over a refused value, the storage being one record. */
  refusesSaves: boolean
}

const sqliteFile = temporarySqliteFiles()

function savedSqlite() {
  const opened = sqliteFile()
  const { storage } = opened
  storage.saveTeam(TEAM)
  storage.saveMilestoneInputs(LAUNCH)
  storage.saveMilestoneQuery('team', PICKED)
  storage.saveComparableWorkQuery('team', PICKED)
  storage.saveSetupDraft('team', { milestoneQuery: PICKED, comparableWorkQuery: PICKED, reads: [] })
  return opened
}

/** Values in `table`'s columns, each read through `read`, and holding the value itself unless named otherwise. */
const inSqlite =
  (table: string, read: (storage: SqliteStorage) => unknown, ownSave?: Save) =>
  (column: string, stored: string, holding = stored): Refused => ({
    where: `${table}.${column}`,
    holding,
    ...(ownSave && { ownSave }),
    opened() {
      const { file, reopen } = savedSqlite()
      const db = new DatabaseSync(file)
      db.prepare(`UPDATE ${table} SET ${column} = ?`).run(stored)
      db.close()
      const kept = (): unknown => {
        const again = new DatabaseSync(file)
        const row = again.prepare(`SELECT ${column} FROM ${table}`).get()
        again.close()
        return row?.[column]
      }
      return { storage: reopen, read: () => read(reopen()), kept }
    },
  })

const inputs = inSqlite('milestone_inputs', (storage) => storage.milestoneInputs('team'), 'saveMilestoneInputs')
const milestoneQuery = inSqlite('milestone_queries', (storage) => storage.milestoneQuery('team'))
const comparableWorkQuery = inSqlite('comparable_work_queries', (storage) => storage.comparableWorkQuery('team'))
const setupDraft = inSqlite('setup_drafts', (storage) => storage.setupDraft('team'))

const sqlite: Subject = {
  saved: () => savedSqlite().reopen(),
  refusesSaves: false,
  refused: [
    inputs('pace_counts', '{"low":4}'),
    inputs('pace_counts', '[4,"seven"]'),
    inputs('pace_window', '[]'),
    inputs('pace_window', '{"action":{"kind":"startFrom"}}'),
    inputs('pace_window', '{"skippedPeriods":"2026-09-28"}'),
    inputs('seen_reads', '"seen"'),
    inputs('seen_reads', '{"pace":3}'),
    milestoneQuery('picks', '{}'),
    milestoneQuery('picks', '[{"kind":"label","name":"payments"}]'),
    comparableWorkQuery('picks', '[null]'),
    setupDraft('milestone_picks', 'not json'),
    setupDraft('comparable_work_picks', '[{"kind":"label","name":7,"query":""}]'),
  ],
}

/** Browser storage holding everything under one key, as `localStorage` keeps it. */
const KEY = '"forecaster"'

/** Browser storage on the team and its milestone's inputs as saved through it, and the items it keeps them in. */
function savedBrowser() {
  const items = new Map<string, string>()
  const store: KeyValueStore = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
  const saved = openWebStorage(store)
  saved.saveTeam(TEAM)
  saved.saveMilestoneInputs(LAUNCH)
  return { items, storage: () => openWebStorage(store) }
}

/** The browser's stored value holding `holding`, and its inputs read back through the storage. */
const inBrowser = (holding: string, stored: string): Refused => ({
  where: KEY,
  holding,
  opened() {
    const { items, storage } = savedBrowser()
    items.set('forecaster', stored)
    return { storage, read: () => storage().milestoneInputs('team'), kept: () => items.get('forecaster') }
  },
})

/** The browser's stored value with the team's milestone inputs replaced by `inputs` (`LAUNCH`'s fields, changed). */
const withInputs = (inputs: Record<string, unknown>): string => JSON.stringify({ teams: [TEAM], milestoneInputs: { team: { ...LAUNCH, ...inputs } } })

const browser: Subject = {
  saved: () => savedBrowser().storage(),
  refusesSaves: true,
  refused: [
    inBrowser("text that isn't JSON", 'not json'),
    inBrowser('a list, not an object', '[]'),
    inBrowser('teams that are not a list', '{"teams":"My team"}'),
    inBrowser("a team from a source it doesn't know", JSON.stringify({ teams: [{ ...TEAM, source: 'trello' }] })),
    inBrowser('milestone inputs that are a list', JSON.stringify({ teams: [TEAM], milestoneInputs: [] })),
    inBrowser("a team's milestone inputs that are text", JSON.stringify({ teams: [TEAM], milestoneInputs: { team: 'Launch' } })),
    inBrowser('a milestone name that is a number', withInputs({ name: 7 })),
    inBrowser("an ambiguity it doesn't know", withInputs({ ambiguity: 'extreme' })),
    inBrowser("a pace mode it doesn't know", withInputs({ paceMode: 'guess' })),
    inBrowser("a tickets source it doesn't know", withInputs({ ticketsSource: 'both' })),
    inBrowser('a pace range with no high', withInputs({ paceRange: { low: 5 } })),
    inBrowser('pace counts that are not all numbers', withInputs({ paceCounts: [4, 'seven'] })),
    inBrowser('a pace window starting from no date', withInputs({ paceWindow: { action: { kind: 'startFrom' } } })),
    inBrowser('a pace read seen that is a number', withInputs({ seenReads: { pace: 3 } })),
    inBrowser('ambiguity ranges missing a level', JSON.stringify({ teams: [TEAM], ambiguityRanges: { team: { teamId: 'team', low: { low: 1 } } } })),
    inBrowser("a team's capacity entries that are text", JSON.stringify({ teams: [TEAM], capacityEntries: { team: 'x' } })),
    inBrowser('a capacity entry with no percent', JSON.stringify({ teams: [TEAM], capacityEntries: { team: [{ id: 1, from: '2026-09-14', note: '' }] } })),
    inBrowser(
      'a capacity entry kept as false',
      JSON.stringify({ teams: [TEAM], capacityEntries: { team: [{ id: 1, from: '2026-09-14', percent: 0, note: '', kept: false }] } }),
    ),
    inBrowser('capacity off that is not a list', '{"teams":[],"capacityOff":"team"}'),
  ],
}

describe.each([
  ['SQLite', sqlite],
  ['browser', browser],
])('%s storage holding stored JSON of a shape it does not read', (_, subject) => {
  test('reads back each stored JSON value as saved', () => {
    expect(subject.saved().milestoneInputs('team')).toEqual(LAUNCH)
  })

  test.each(subject.refused)('refuses $where holding $holding, naming where it is kept', ({ where, opened }) => {
    expect(opened().read).toThrow(where)
  })

  test.each(subject.refused)(
    'keeps $where holding $holding as it was through every save but one replacing its record, refusing it still',
    ({ where, opened, ownSave }) => {
      const { storage, read, kept } = opened()
      const before = kept()

      for (const [name, save] of Object.entries(SAVES)) {
        if (name === ownSave) continue
        const saving = () => save(storage())
        if (subject.refusesSaves) expect(saving, name).toThrow(where)
        else saving()
        expect(kept(), name).toBe(before)
      }

      expect(read).toThrow(where)
    },
  )
})

test('SQLite storage reads back the queries and setup draft as saved', () => {
  const storage = savedSqlite().reopen()

  expect(storage.milestoneQuery('team')).toEqual(PICKED)
  expect(storage.comparableWorkQuery('team')).toEqual(PICKED)
  expect(storage.setupDraft('team')).toEqual({ milestoneQuery: PICKED, comparableWorkQuery: PICKED, reads: [] })
})

test("SQLite storage's save of the record holding a refused value replaces it whole, dropping what it doesn't know", () => {
  const { storage, read } = inputs('pace_counts', '[4,"seven"]').opened()

  SAVES.saveMilestoneInputs(storage())

  expect(read()).toEqual({ ...LAUNCH, name: 'Beta' })
})
