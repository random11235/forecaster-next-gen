import { describe, expect, test } from 'vitest'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'
import { readStraight, writeStraight } from './sqliteStraight.js'
import { FORECAST, LAUNCH as SAVED, TEAM, temporarySqliteFiles } from './storageContractFixtures.js'

// The Storage contract's cases for stored JSON of a shape this version doesn't read, beside storageContract.test.ts,
// run against both storages: each refuses it, naming where it is kept, rather than reading it as something it isn't,
// and keeps it through the Storage contract's saves. Browser storage keeps two records, the forecast ledger apart from
// the rest: it refuses every save to the rest when that holds the refused value, and refuses no save when the ledger
// does, logging nothing; the SQLite file takes them, but its save of
// the milestone inputs replaces a refused value in that record whole. The saves of the
// SQLite-only tables (the queries', the setup draft's) aren't tried. Only the seeding differs: each case writes the
// value straight into the store, as a later version or a damaged file would leave it.

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
  saveForecastLog: (storage) => storage.saveForecastLog(FORECAST),
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
  /** The saves that throw over a refused value: those to the record holding it, where the storage keeps few. */
  refusingSaves: Save[]
}

const ALL_SAVES = Object.keys(SAVES).filter((name): name is Save => name in SAVES)

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
      writeStraight(file, `UPDATE ${table} SET ${column} = ?`, stored)
      const kept = (): unknown => readStraight(file, `SELECT ${column} FROM ${table}`)?.[column]
      return { storage: reopen, read: () => read(reopen()), kept }
    },
  })

const inputs = inSqlite('milestone_inputs', (storage) => storage.milestoneInputs('team'), 'saveMilestoneInputs')
const milestoneQuery = inSqlite('milestone_queries', (storage) => storage.milestoneQuery('team'))
const comparableWorkQuery = inSqlite('comparable_work_queries', (storage) => storage.comparableWorkQuery('team'))
const setupDraft = inSqlite('setup_drafts', (storage) => storage.setupDraft('team'))

/**
 * A logged forecast whose `column` holds `stored`, the rest as FORECAST logged it: written in as a row of its own, as
 * the ledger never changes a row once written.
 */
const forecastLog = (column: 'simulation_case' | 'result', stored: string): Refused => ({
  where: `forecast_logs.${column}`,
  holding: stored,
  opened() {
    const { file, reopen } = savedSqlite()
    const { teamId, milestoneName, appVersion, simulationCase, result } = FORECAST
    const json = { simulation_case: JSON.stringify(simulationCase), result: JSON.stringify(result), [column]: stored }
    writeStraight(
      file,
      `INSERT INTO forecast_logs (team_id, id, created_at, milestone_name, app_version, simulation_case, result)
       VALUES (?, 1, '2026-11-02T09:00:00.000Z', ?, ?, ?, ?)`,
      teamId,
      milestoneName,
      appVersion,
      json.simulation_case,
      json.result,
    )
    const kept = (): unknown => readStraight(file, `SELECT ${column} FROM forecast_logs WHERE id = 1`)?.[column]
    return { storage: reopen, read: () => reopen().forecastLogs('team'), kept }
  },
})

const sqlite: Subject = {
  saved: () => savedSqlite().reopen(),
  refusingSaves: [],
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
    forecastLog('simulation_case', 'not json'),
    forecastLog('simulation_case', JSON.stringify({ ...FORECAST.simulationCase, question: { kind: 'howMany' } })),
    forecastLog('simulation_case', JSON.stringify({ ...FORECAST.simulationCase, scope: [{ epicId: 'team', rank: 1 }] })),
    forecastLog('result', JSON.stringify({ ...FORECAST.result, percentileDates: { 50: 20270222 } })),
    forecastLog('result', '[]'),
  ],
}

/** Browser storage's keys, as `localStorage` keeps them: the forecast ledger under one, everything else under the other. */
const KEY = 'forecaster'
const LEDGER_KEY = 'forecaster.ledger'

/** Browser storage on the team and its milestone's inputs as saved through it, and the items it keeps them in. */
function savedBrowser() {
  const items = new Map<string, string>()
  const store: KeyValueStore = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
  const saved = openWebStorage(store)
  saved.saveTeam(TEAM)
  saved.saveMilestoneInputs(LAUNCH)
  return { items, storage: () => openWebStorage(store) }
}

/** The browser's value under `key` holding `holding`, read back through the storage by `read`. */
const underKey =
  (key: string, read: (storage: Storage) => unknown) =>
  (holding: string, stored: string): Refused => ({
    where: `"${key}"`,
    holding,
    opened() {
      const { items, storage } = savedBrowser()
      items.set(key, stored)
      return { storage, read: () => read(storage()), kept: () => items.get(key) }
    },
  })

const inBrowser = underKey(KEY, (storage) => storage.milestoneInputs('team'))
const inLedger = underKey(LEDGER_KEY, (storage) => storage.forecastLogs('team'))

/** The browser's stored value with the team's milestone inputs replaced by `inputs` (`LAUNCH`'s fields, changed). */
const withInputs = (inputs: Record<string, unknown>): string => JSON.stringify({ teams: [TEAM], milestoneInputs: { team: { ...LAUNCH, ...inputs } } })

const browser: Subject = {
  saved: () => savedBrowser().storage(),
  refusingSaves: ALL_SAVES.filter((name) => name !== 'saveForecastLog'),
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

/** Browser storage's forecast ledger, kept apart: refused, it refuses no save, a forecast saved to it not being logged. */
const browserLedger: Subject = {
  saved: () => savedBrowser().storage(),
  refusingSaves: [],
  refused: [
    inLedger("text that isn't JSON", 'not json'),
    inLedger("a team's forecast ledger with no logs", JSON.stringify({ team: { lastId: 0 } })),
    inLedger('a logged forecast with no stamp', JSON.stringify({ team: { lastId: 1, logs: [{ ...FORECAST, id: 1 }] } })),
    inLedger(
      'a logged forecast whose result has no case hash',
      JSON.stringify({ team: { lastId: 1, logs: [{ ...FORECAST, id: 1, createdAt: '2026-11-02T09:00:00.000Z', result: {} }] } }),
    ),
  ],
}

describe.each([
  ['SQLite', sqlite],
  ['browser', browser],
  ["browser storage's forecast ledger in", browserLedger],
])('%s storage holding stored JSON of a shape it does not read', (_, subject) => {
  test('reads back the milestone inputs as saved', () => {
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

      for (const name of ALL_SAVES) {
        if (name === ownSave) continue
        const saving = () => SAVES[name](storage())
        if (subject.refusingSaves.includes(name)) expect(saving, name).toThrow(where)
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
